import { createHash } from 'node:crypto';
import { mongo } from 'mongoose';
import { deriveLevel } from '../common/xp-level';
import {
  TARGET_LANGUAGE_NAMES,
  tryTargetLanguage,
} from '../common/target-language';

export type Classification =
  | 'DETERMINISTIC_REPAIR'
  | 'AMBIGUOUS_REVIEW'
  | 'DANGEROUS_OWNERSHIP'
  | 'SAFE_COMPATIBILITY'
  | 'INFORMATIONAL';
export interface Finding {
  category: string;
  classification: Classification;
  evidence: Record<string, unknown>;
}
export interface FieldChange {
  path: string;
  beforeExists: boolean;
  before?: unknown;
  after: string;
}
export interface UserAudit {
  type: 'user';
  userId: string;
  auditedAt: string;
  fingerprint: string;
  totalXp: unknown;
  storedGlobalLevel: unknown;
  derivedGlobalLevel: string | null;
  progressEpoch: unknown;
  progressWriteRevision: unknown;
  languages: Record<
    string,
    {
      buckets: Record<string, unknown>;
      effectiveXp: number | null;
      derivedLevel: string | null;
      storedLevels: Record<string, unknown>;
    }
  >;
  completionCount: number;
  withAwardProvenance: number;
  withoutAwardProvenance: number;
  knownAwardedXp: number | null;
  knownLanguageAwards: Record<string, number | null>;
  aggregateReconstructable: boolean;
  languageReconstructable: boolean;
  findings: Finding[];
  findingCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  omittedFindings: number;
  deterministicRepairs: FieldChange[];
}
export interface AuditOptions {
  userId?: string;
  after?: string;
  limit: number | null;
  batchSize: number;
}
const codes = Object.keys(TARGET_LANGUAGE_NAMES);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const own = (v: object, key: string) =>
  Object.prototype.hasOwnProperty.call(v, key);
const objectMap = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const safeValue = (v: unknown): unknown =>
  v === undefined
    ? null
    : typeof v === 'string'
      ? v.slice(0, 128)
      : typeof v === 'number' || typeof v === 'boolean' || v === null
        ? v
        : '[invalid representation]';
const repairableLevel = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.length <= 128) ||
  typeof v === 'number' ||
  typeof v === 'boolean';
export function objectId(value: string): mongo.ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(value))
    throw new Error('A MongoDB user/receipt ID is required');
  return new mongo.ObjectId(value);
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
// Hash the full raw record, but never output credentials, names or email. This
// also notices profile edits and writes that did not update a revision field.
export function stateFingerprint(user: mongo.Document): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable(mongo.BSON.EJSON.serialize(user, { relaxed: false })),
      ),
    )
    .digest('hex');
}
function add(
  report: UserAudit,
  category: string,
  classification: Classification,
  evidence: Record<string, unknown>,
) {
  report.findingCounts[category] = (report.findingCounts[category] ?? 0) + 1;
  report.classificationCounts[classification] =
    (report.classificationCounts[classification] ?? 0) + 1;
  if (report.findings.length < 200)
    report.findings.push({ category, classification, evidence });
  else report.omittedFindings++;
}

/** Raw driver access: no schema defaults, seeds, model hooks, or public routes. */
export class ProgressAuditTool {
  readonly users: mongo.Collection;
  readonly progress: mongo.Collection;
  readonly lessons: mongo.Collection;
  readonly receipts: mongo.Collection;
  constructor(
    readonly client: mongo.MongoClient,
    readonly db: mongo.Db,
  ) {
    this.users = db.collection('users');
    this.progress = db.collection('progresses');
    this.lessons = db.collection('lessons');
    this.receipts = db.collection('progressauditrepairs');
  }

  async auditUser(
    user: mongo.Document,
    batchSize = 100,
    session?: mongo.ClientSession,
  ): Promise<UserAudit> {
    const epoch = user.progressEpoch === undefined ? 0 : user.progressEpoch;
    const report: UserAudit = {
      type: 'user',
      userId: String(user._id),
      auditedAt: new Date().toISOString(),
      fingerprint: stateFingerprint(user),
      totalXp: safeValue(user.totalXp),
      storedGlobalLevel: safeValue(user.level),
      derivedGlobalLevel: integer(user.totalXp)
        ? deriveLevel(user.totalXp)
        : null,
      progressEpoch: safeValue(epoch),
      progressWriteRevision: safeValue(user.progressWriteRevision),
      languages: {},
      completionCount: 0,
      withAwardProvenance: 0,
      withoutAwardProvenance: 0,
      knownAwardedXp: 0,
      knownLanguageAwards: {},
      aggregateReconstructable: true,
      languageReconstructable: true,
      findings: [],
      findingCounts: {},
      classificationCounts: {},
      omittedFindings: 0,
      deterministicRepairs: [],
    };
    if (!(user._id instanceof mongo.ObjectId)) {
      add(report, 'MALFORMED_USER_ID', 'DANGEROUS_OWNERSHIP', {
        ownerId: String(user._id),
      });
      report.aggregateReconstructable = report.languageReconstructable = false;
      return report;
    }
    if (!integer(epoch))
      add(report, 'INVALID_OWNER_EPOCH', 'AMBIGUOUS_REVIEW', {
        epoch: safeValue(epoch),
      });
    else if (user.progressEpoch === undefined)
      add(report, 'MISSING_OWNER_EPOCH', 'SAFE_COMPATIBILITY', {
        effectiveEpoch: 0,
      });
    if (report.derivedGlobalLevel === null)
      add(report, 'INVALID_TOTAL_XP', 'AMBIGUOUS_REVIEW', {
        totalXp: report.totalXp,
      });
    else if (user.level !== report.derivedGlobalLevel) {
      add(
        report,
        'GLOBAL_LEVEL_DRIFT',
        repairableLevel(user.level)
          ? 'DETERMINISTIC_REPAIR'
          : 'AMBIGUOUS_REVIEW',
        {
          stored: report.storedGlobalLevel,
          derived: report.derivedGlobalLevel,
        },
      );
      if (repairableLevel(user.level))
        report.deterministicRepairs.push({
          path: 'level',
          beforeExists: own(user, 'level'),
          ...(own(user, 'level') ? { before: user.level } : {}),
          after: report.derivedGlobalLevel,
        });
    }
    const xpMap = user.xpPerLanguage === undefined ? {} : user.xpPerLanguage;
    const levelMap =
      user.levelPerLanguage === undefined ? {} : user.levelPerLanguage;
    if (!objectMap(xpMap))
      add(report, 'INVALID_LANGUAGE_XP_MAP', 'AMBIGUOUS_REVIEW', {});
    if (!objectMap(levelMap))
      add(report, 'INVALID_LANGUAGE_LEVEL_MAP', 'AMBIGUOUS_REVIEW', {});
    if (objectMap(xpMap)) {
      for (const [key, xp] of Object.entries(xpMap)) {
        const code = tryTargetLanguage(key);
        if (!code) {
          add(report, 'UNKNOWN_LANGUAGE_BUCKET', 'AMBIGUOUS_REVIEW', { key });
          continue;
        }
        const language = (report.languages[code] ??= {
          buckets: {},
          effectiveXp: 0,
          derivedLevel: null,
          storedLevels: {},
        });
        language.buckets[key] = safeValue(xp);
        if (key !== code)
          add(report, 'LANGUAGE_BUCKET_ALIAS', 'SAFE_COMPATIBILITY', {
            key,
            code,
          });
        if (
          !integer(xp) ||
          language.effectiveXp === null ||
          !integer(language.effectiveXp + xp)
        ) {
          language.effectiveXp = null;
          add(report, 'INVALID_LANGUAGE_XP', 'AMBIGUOUS_REVIEW', {
            key,
            xp: safeValue(xp),
          });
        } else language.effectiveXp += xp; // Exactly the runtime's additive alias read.
      }
    }
    if (objectMap(levelMap)) {
      for (const [key, level] of Object.entries(levelMap)) {
        const code = tryTargetLanguage(key);
        if (!code) {
          add(report, 'UNKNOWN_LANGUAGE_LEVEL', 'AMBIGUOUS_REVIEW', { key });
          continue;
        }
        const language = (report.languages[code] ??= {
          buckets: {},
          effectiveXp: objectMap(xpMap) ? 0 : null,
          derivedLevel: null,
          storedLevels: {},
        });
        language.storedLevels[key] = safeValue(level);
        if (key !== code)
          add(report, 'LANGUAGE_LEVEL_ALIAS', 'SAFE_COMPATIBILITY', {
            key,
            code,
          });
      }
    }
    for (const [code, language] of Object.entries(report.languages)) {
      const overlap = Object.keys(language.buckets).length > 1;
      if (overlap)
        add(report, 'MIXED_LANGUAGE_BUCKETS', 'AMBIGUOUS_REVIEW', {
          code,
          buckets: language.buckets,
          runtimeRead: 'additive; historical award overlap cannot be inferred',
        });
      if (language.effectiveXp === null) continue;
      language.derivedLevel = deriveLevel(language.effectiveXp);
      if (objectMap(levelMap)) {
        for (const key of new Set([
          code,
          ...Object.keys(language.storedLevels),
        ])) {
          if (levelMap[key] === language.derivedLevel) continue;
          const deterministic =
            key === code && !overlap && repairableLevel(levelMap[key]);
          add(
            report,
            'LANGUAGE_LEVEL_DRIFT',
            deterministic ? 'DETERMINISTIC_REPAIR' : 'AMBIGUOUS_REVIEW',
            {
              code,
              key,
              stored: safeValue(levelMap[key]),
              derived: language.derivedLevel,
            },
          );
          if (deterministic)
            report.deterministicRepairs.push({
              path: `levelPerLanguage.${code}`,
              beforeExists: own(levelMap, code),
              ...(own(levelMap, code) ? { before: levelMap[code] } : {}),
              after: language.derivedLevel,
            });
        }
      }
    }
    // Include string-shaped references for diagnosis only, never reassign them.
    const ownerFilter = { userId: { $in: [user._id, user._id.toHexString()] } };
    const cursor = this.progress
      .find(ownerFilter, {
        session,
        projection: {
          userId: 1,
          lessonId: 1,
          score: 1,
          status: 1,
          awardedXp: 1,
          targetLanguage: 1,
          progressEpoch: 1,
          completedAt: 1,
          createdAt: 1,
        },
      })
      .sort({ _id: 1 })
      .batchSize(batchSize);
    try {
      for await (const row of cursor) {
        report.completionCount++;
        const evidence = {
          rowId: String(row._id),
          lessonId: safeValue(row.lessonId),
        };
        let reconstructable = true;
        if (
          !(row.userId instanceof mongo.ObjectId) ||
          !row.userId.equals(user._id)
        ) {
          add(report, 'MALFORMED_ROW_OWNER', 'DANGEROUS_OWNERSHIP', evidence);
          reconstructable = false;
        }
        if (row.status !== 'completed') {
          add(report, 'NON_COMPLETED_STATUS', 'AMBIGUOUS_REVIEW', {
            ...evidence,
            status: safeValue(row.status),
            currentReadIncludesRow: true,
          });
          reconstructable = false;
        }
        if (!integer(row.score) || row.score > 100)
          add(report, 'INVALID_SCORE', 'AMBIGUOUS_REVIEW', {
            ...evidence,
            score: safeValue(row.score),
          });
        const rowEpoch =
          row.progressEpoch === undefined && epoch === 0
            ? 0
            : row.progressEpoch;
        if (row.progressEpoch === undefined)
          add(
            report,
            'MISSING_ROW_EPOCH',
            epoch === 0 ? 'SAFE_COMPATIBILITY' : 'AMBIGUOUS_REVIEW',
            evidence,
          );
        if (!integer(epoch) || !integer(rowEpoch) || rowEpoch !== epoch) {
          add(report, 'ROW_EPOCH_MISMATCH', 'AMBIGUOUS_REVIEW', {
            ...evidence,
            rowEpoch: safeValue(row.progressEpoch),
            ownerEpoch: safeValue(epoch),
          });
          reconstructable = false;
        }
        const code = tryTargetLanguage(row.targetLanguage);
        if (!code)
          add(report, 'INVALID_COMPLETION_LANGUAGE', 'AMBIGUOUS_REVIEW', {
            ...evidence,
            targetLanguage: safeValue(row.targetLanguage),
          });
        else if (row.targetLanguage !== code)
          add(report, 'COMPLETION_LANGUAGE_ALIAS', 'SAFE_COMPATIBILITY', {
            ...evidence,
            code,
            alias: row.targetLanguage,
          });
        let lesson: mongo.Document | null = null;
        if (typeof row.lessonId === 'string' && row.lessonId.length > 0) {
          lesson = await this.lessons.findOne(
            { id: row.lessonId },
            { session, projection: { id: 1, targetLanguage: 1 } },
          );
        } else reconstructable = false;
        if (!lesson)
          add(report, 'UNKNOWN_LESSON_ID', 'AMBIGUOUS_REVIEW', evidence);
        else {
          if (/^\d+$/.test(row.lessonId))
            add(report, 'LEGACY_LESSON_ID', 'SAFE_COMPATIBILITY', evidence);
          if (code && tryTargetLanguage(lesson.targetLanguage) !== code) {
            add(
              report,
              'LESSON_LANGUAGE_CONFLICT',
              'AMBIGUOUS_REVIEW',
              evidence,
            );
            report.languageReconstructable = false;
          }
        }
        const date = row.completedAt ?? row.createdAt;
        if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
          add(
            report,
            'MISSING_OR_INVALID_COMPLETION_TIME',
            'INFORMATIONAL',
            evidence,
          );
        if (!own(row, 'awardedXp')) {
          report.withoutAwardProvenance++;
          add(report, 'MISSING_AWARDED_XP', 'AMBIGUOUS_REVIEW', evidence);
          reconstructable = false;
        } else {
          report.withAwardProvenance++;
          if (!integer(row.awardedXp)) {
            add(report, 'INVALID_AWARDED_XP', 'AMBIGUOUS_REVIEW', {
              ...evidence,
              awardedXp: safeValue(row.awardedXp),
            });
            reconstructable = false;
          } else {
            if (
              report.knownAwardedXp !== null &&
              integer(report.knownAwardedXp + row.awardedXp)
            )
              report.knownAwardedXp += row.awardedXp;
            else {
              report.knownAwardedXp = null;
              reconstructable = false;
              add(report, 'AWARD_SUM_OVERFLOW', 'AMBIGUOUS_REVIEW', evidence);
            }
            if (code) {
              const known = own(report.knownLanguageAwards, code)
                ? report.knownLanguageAwards[code]
                : 0;
              report.knownLanguageAwards[code] =
                known !== null && integer(known + row.awardedXp)
                  ? known + row.awardedXp
                  : null;
            }
          }
        }
        report.aggregateReconstructable &&= reconstructable;
        report.languageReconstructable &&= reconstructable && !!code;
      }
    } finally {
      await cursor.close();
    }
    const duplicates = this.progress.aggregate(
      [
        { $match: ownerFilter },
        { $group: { _id: '$lessonId', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ],
      { session, batchSize, allowDiskUse: false },
    );
    try {
      for await (const duplicate of duplicates) {
        add(report, 'DUPLICATE_COMPLETION', 'AMBIGUOUS_REVIEW', {
          lessonId: safeValue(duplicate._id),
          count: duplicate.count,
        });
        report.aggregateReconstructable =
          report.languageReconstructable = false;
      }
    } finally {
      await duplicates.close();
    }
    if (!report.aggregateReconstructable)
      add(report, 'PARTIAL_AWARD_PROVENANCE', 'AMBIGUOUS_REVIEW', {
        knownAwardedXp: report.knownAwardedXp,
        totalXp: report.totalXp,
        note: 'Partial evidence is not a replacement aggregate',
      });
    if (integer(user.totalXp) && user.totalXp !== report.knownAwardedXp)
      add(report, 'TOTAL_XP_MISMATCH', 'AMBIGUOUS_REVIEW', {
        totalXp: user.totalXp,
        knownAwardedXp: report.knownAwardedXp,
        completeRowEvidence: report.aggregateReconstructable,
        note: 'No automatic XP repair; historical non-lesson awards/deleted rows may not be represented',
      });
    for (const code of codes) {
      const known = own(report.knownLanguageAwards, code)
        ? report.knownLanguageAwards[code]
        : 0;
      const effective = objectMap(xpMap)
        ? report.languages[code]
          ? report.languages[code].effectiveXp
          : 0
        : null;
      if (known !== effective)
        add(report, 'LANGUAGE_XP_MISMATCH', 'AMBIGUOUS_REVIEW', {
          code,
          effectiveXp: effective,
          knownAwardedXp: known,
          completeRowEvidence: report.languageReconstructable,
        });
    }
    const latest = await this.users.findOne({ _id: user._id }, { session });
    if (!latest || stateFingerprint(latest) !== report.fingerprint) {
      add(report, 'AUDIT_STATE_CHANGED', 'INFORMATIONAL', {
        note: 'Repeat audit before applying',
      });
      report.deterministicRepairs = [];
    }
    if (report.findingCounts.MALFORMED_ROW_OWNER || !integer(epoch))
      report.deterministicRepairs = [];
    return report;
  }

  async apply(
    report: UserAudit,
    options: { apply: boolean },
  ): Promise<mongo.Document | null> {
    if (options.apply !== true)
      throw new Error('Mutation requires explicit --apply');
    const id = objectId(report.userId);
    const session = this.client.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const current = await this.users.findOne({ _id: id }, { session });
          if (!current || stateFingerprint(current) !== report.fingerprint)
            throw new Error('State changed since audit; repair refused');
          const fresh = await this.auditUser(current, 100, session);
          if (!fresh.deterministicRepairs.length) return null;
          // Ignore proposals supplied by callers; rebuild the allowlist from raw
          // evidence inside this transaction. No XP, ownership, aliases, or rows.
          const fields = fresh.deterministicRepairs;
          const update = Object.fromEntries(
            fields.map((field) => [field.path, field.after]),
          );
          const changed = await this.users.updateOne(
            { _id: id },
            { $set: update },
            { session },
          );
          if (changed.matchedCount !== 1)
            throw new Error('Owner no longer exists');
          const after = (await this.users.findOne({ _id: id }, { session }))!;
          const receipt = {
            _id: new mongo.ObjectId(),
            type: 'derived-level-repair',
            userId: id,
            status: 'applied',
            auditedAt: fresh.auditedAt,
            appliedAt: new Date(),
            progressEpoch: current.progressEpoch ?? 0,
            progressWriteRevision: current.progressWriteRevision ?? null,
            languageLevelsAbsent: !own(current, 'levelPerLanguage'),
            beforeFingerprint: fresh.fingerprint,
            afterFingerprint: stateFingerprint(after),
            fields,
            before: {
              level: safeValue(current.level),
              languageLevels: fresh.languages,
            },
            after: {
              level: safeValue(after.level),
              languageLevels: Object.fromEntries(
                fields
                  .filter((f) => f.path !== 'level')
                  .map((f) => [f.path, f.after]),
              ),
            },
          };
          // Durable rollback evidence commits with the repair, even if output fails.
          await this.receipts.insertOne(receipt, { session });
          return receipt;
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }

  async rollback(
    receiptId: string,
    options: { apply: boolean },
  ): Promise<mongo.Document> {
    if (options.apply !== true)
      throw new Error('Rollback requires explicit --apply');
    const session = this.client.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const receipt = await this.receipts.findOne(
            { _id: objectId(receiptId) },
            { session },
          );
          if (
            !receipt ||
            receipt.type !== 'derived-level-repair' ||
            receipt.status !== 'applied' ||
            !(receipt.userId instanceof mongo.ObjectId) ||
            !Array.isArray(receipt.fields)
          )
            throw new Error('Invalid repair receipt');
          const user = await this.users.findOne(
            { _id: receipt.userId },
            { session },
          );
          if (!user || stateFingerprint(user) !== receipt.afterFingerprint)
            throw new Error('State changed since repair; rollback refused');
          const set: Record<string, unknown> = {},
            unset: Record<string, string> = {};
          for (const field of receipt.fields) {
            if (
              field.path !== 'level' &&
              !/^levelPerLanguage\.(en|de|es|fr|ar)$/.test(field.path)
            )
              throw new Error('Unsafe rollback field');
            if (field.beforeExists) set[field.path] = field.before;
            else unset[field.path] = '';
          }
          await this.users.updateOne(
            { _id: receipt.userId },
            {
              ...(Object.keys(set).length ? { $set: set } : {}),
              ...(Object.keys(unset).length ? { $unset: unset } : {}),
            },
            { session },
          );
          // A newly introduced parent map must also disappear to restore exact state.
          const restored = (await this.users.findOne(
            { _id: receipt.userId },
            { session },
          ))!;
          // Missing parent vs empty parent is recorded separately by apply.
          if (
            receipt.languageLevelsAbsent &&
            objectMap(restored.levelPerLanguage) &&
            Object.keys(restored.levelPerLanguage).length === 0
          ) {
            await this.users.updateOne(
              { _id: receipt.userId },
              { $unset: { levelPerLanguage: '' } },
              { session },
            );
          }
          const final = (await this.users.findOne(
            { _id: receipt.userId },
            { session },
          ))!;
          if (stateFingerprint(final) !== receipt.beforeFingerprint)
            throw new Error('Rollback did not restore audited state');
          await this.receipts.updateOne(
            { _id: receipt._id, status: 'applied' },
            { $set: { status: 'rolled-back', rolledBackAt: new Date() } },
            { session },
          );
          return {
            type: 'rollback',
            receiptId,
            userId: receipt.userId.toHexString(),
            restoredFingerprint: stateFingerprint(final),
          };
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }

  async run(
    options: AuditOptions,
    emit: (record: unknown) => Promise<void>,
    apply = false,
    count: (users: number) => void = () => {},
  ): Promise<{ users: number; failedUsers: number; dangerousRows: number }> {
    if (
      !Number.isInteger(options.batchSize) ||
      options.batchSize < 1 ||
      options.batchSize > 500 ||
      (options.limit !== null &&
        (!Number.isInteger(options.limit) || options.limit < 1))
    )
      throw new Error('Invalid execution bounds');
    if (options.userId && options.after)
      throw new Error('Cannot combine --user and --after');
    const filter = options.userId
      ? { _id: objectId(options.userId) }
      : options.after
        ? { _id: { $gt: objectId(options.after) } }
        : {};
    const cursor = this.users
      .find(filter)
      .sort({ _id: 1 })
      .batchSize(options.batchSize)
      .limit(options.limit ?? 0);
    const counters = { users: 0, failedUsers: 0, dangerousRows: 0 };
    try {
      for await (const user of cursor) {
        counters.users++;
        try {
          const report = await this.auditUser(user, options.batchSize);
          await emit(report);
          if (apply && report.deterministicRepairs.length) {
            const receipt = await this.apply(report, { apply: true });
            if (receipt)
              await emit({
                ...receipt,
                type: 'repair',
                repairType: receipt.type,
              });
          }
        } catch {
          counters.failedUsers++;
          // Driver errors may contain connection secrets or raw documents.
          await emit({
            type: 'user-error',
            userId: String(user._id),
            message:
              'Audit/repair failed; user isolated. No repair is inferred.',
          });
        }
        if (counters.users % options.batchSize === 0) count(counters.users);
      }
    } finally {
      await cursor.close();
    }
    // Explicit global ownership pass: bounded memory, never lookup by email.
    // Limited runs avoid an accidental full-database sweep. --all scans every
    // row; --user includes only references to that owner.
    if (options.limit === null || options.userId) {
      const rows = this.progress
        .find(
          options.userId
            ? { userId: { $in: [objectId(options.userId), options.userId] } }
            : {},
          {
            projection: {
              userId: 1,
              lessonId: 1,
              score: 1,
              status: 1,
              awardedXp: 1,
              targetLanguage: 1,
              progressEpoch: 1,
              completedAt: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ _id: 1 })
        .batchSize(options.batchSize);
      try {
        for await (const row of rows) {
          const valid = row.userId instanceof mongo.ObjectId;
          const owner = valid
            ? await this.users.findOne(
                { _id: row.userId },
                { projection: { _id: 1 } },
              )
            : null;
          if (!valid || !owner) {
            counters.dangerousRows++;
            const evidence = {
              rowId: String(row._id),
              userId: safeValue(valid ? row.userId.toHexString() : row.userId),
              lessonId: safeValue(row.lessonId),
            };
            const findings: Finding[] = [];
            const issue = (
              category: string,
              details: Record<string, unknown> = {},
              classification: Classification = 'AMBIGUOUS_REVIEW',
            ) =>
              findings.push({
                category,
                classification,
                evidence: { ...evidence, ...details },
              });
            if (!own(row, 'awardedXp')) issue('MISSING_AWARDED_XP');
            else if (!integer(row.awardedXp))
              issue('INVALID_AWARDED_XP', {
                awardedXp: safeValue(row.awardedXp),
              });
            if (!integer(row.score) || row.score > 100)
              issue('INVALID_SCORE', { score: safeValue(row.score) });
            if (row.status !== 'completed')
              issue('NON_COMPLETED_STATUS', {
                status: safeValue(row.status),
                currentReadIncludesRow: true,
              });
            const language = tryTargetLanguage(row.targetLanguage);
            if (!language)
              issue('INVALID_COMPLETION_LANGUAGE', {
                targetLanguage: safeValue(row.targetLanguage),
              });
            else if (language !== row.targetLanguage)
              issue(
                'COMPLETION_LANGUAGE_ALIAS',
                { code: language, alias: row.targetLanguage },
                'SAFE_COMPATIBILITY',
              );
            if (row.progressEpoch === undefined)
              issue('MISSING_ROW_EPOCH', { ownerEpochUnavailable: true });
            else if (!integer(row.progressEpoch))
              issue('INVALID_ROW_EPOCH', {
                rowEpoch: safeValue(row.progressEpoch),
              });
            const completedAt = row.completedAt ?? row.createdAt;
            if (
              !(completedAt instanceof Date) ||
              !Number.isFinite(completedAt.getTime())
            )
              issue('MISSING_OR_INVALID_COMPLETION_TIME', {}, 'INFORMATIONAL');
            const lesson =
              typeof row.lessonId === 'string'
                ? await this.lessons.findOne(
                    { id: row.lessonId },
                    { projection: { id: 1 } },
                  )
                : null;
            if (!lesson) issue('UNKNOWN_LESSON_ID');
            if (
              (valid || typeof row.userId === 'string') &&
              typeof row.lessonId === 'string'
            ) {
              const duplicates = await this.progress.countDocuments({
                userId: { $eq: row.userId },
                lessonId: { $eq: row.lessonId },
              });
              if (duplicates > 1)
                issue('DUPLICATE_COMPLETION', { count: duplicates });
            }
            await emit({
              type: 'ownership',
              category: valid ? 'ORPHAN_OWNER' : 'MALFORMED_ROW_OWNER',
              classification: 'DANGEROUS_OWNERSHIP',
              evidence,
              provenance: {
                score: safeValue(row.score),
                status: safeValue(row.status),
                awardedXpPresent: own(row, 'awardedXp'),
                awardedXp: safeValue(row.awardedXp),
                targetLanguage: safeValue(row.targetLanguage),
                progressEpoch: safeValue(row.progressEpoch),
              },
              findings,
            });
          }
        }
      } finally {
        await rows.close();
      }
    }
    count(counters.users);
    await emit({
      type: 'summary',
      ...counters,
      mode: apply ? 'apply' : 'dry-run',
      ownershipScan:
        options.limit === null || !!options.userId
          ? 'complete-in-scope'
          : 'not-run; use --all for orphan scan',
    });
    return counters;
  }
}
