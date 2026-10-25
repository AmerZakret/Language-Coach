import { targetLanguageCode } from './targetLanguage';
import type { GetCommunityPostsResponse } from '../api/communityApi';

export interface CommunityQuery { ownerNamespace: string; language: string; page: number; limit: number }
const prefix = 'linguaai_community_feed_v2_';
export function communityQuery(ownerNamespace: string, language = 'All', page = 1, limit = 50): CommunityQuery {
  if (!/^(?:registered_[a-f\d]{24}|guest_[a-f\d]{24}|local_guest)$/i.test(ownerNamespace)
    || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid Community query');
  return { ownerNamespace, language: language.toLowerCase() === 'all' ? 'All' : targetLanguageCode(language), page, limit };
}
export const communityCacheKey = (query: CommunityQuery): string =>
  `${prefix}${encodeURIComponent(query.ownerNamespace)}_${query.language}_${query.page}_${query.limit}`;

export function validCommunityFeed(value: unknown, query: CommunityQuery): value is GetCommunityPostsResponse {
  const data = value as GetCommunityPostsResponse | null;
  return !!data && data.page === query.page && data.limit === query.limit
    && Number.isSafeInteger(data.total) && data.total >= 0 && typeof data.hasMore === 'boolean'
    && Array.isArray(data.items) && data.items.every(post => post && typeof post._id === 'string' && !!post._id
      && typeof post.userId === 'string' && typeof post.userName === 'string' && typeof post.learningLanguage === 'string'
      && Array.isArray(post.likes) && post.likes.every(id => typeof id === 'string')
      && Number.isSafeInteger(post.likesCount) && post.likesCount >= 0 && typeof post.likedByMe === 'boolean'
      && typeof post.createdAt === 'string' && typeof post.updatedAt === 'string'
      && (post.text == null || typeof post.text === 'string') && (post.imageUrl == null || typeof post.imageUrl === 'string'));
}

// Ownerless v1 entries may contain likedByMe. Never read, adopt or relabel them.
export function readCommunityFeed(query: CommunityQuery): GetCommunityPostsResponse | undefined {
  try {
    const raw = localStorage.getItem(communityCacheKey(query));
    if (!raw) return;
    const value = JSON.parse(raw);
    if (value.schemaVersion !== 2 || value.ownerNamespace !== query.ownerNamespace || value.language !== query.language
      || value.page !== query.page || value.limit !== query.limit || !validCommunityFeed(value.payload, query)) return;
    return value.payload;
  } catch { return; }
}
export function writeCommunityFeed(query: CommunityQuery, payload: GetCommunityPostsResponse): void {
  if (!validCommunityFeed(payload, query)) throw new Error('Malformed Community feed');
  try { localStorage.setItem(communityCacheKey(query), JSON.stringify({ schemaVersion: 2, ...query, payload })); }
  catch { /* A cache storage failure must not reject a valid online feed. */ }
}
export function invalidateCommunityFeed(owner: string, change: { postId?: string; language?: string }, requireAcknowledgement = false): void {
  try {
    const ownerPrefix = `${prefix}${encodeURIComponent(owner)}_`;
    const language = change.language ? targetLanguageCode(change.language) : undefined;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (!key?.startsWith(ownerPrefix)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key)!);
        const query = communityQuery(owner, entry.language, entry.page, entry.limit);
        const feed = readCommunityFeed(query);
        if (feed && key === communityCacheKey(query) && ((language && (query.language === 'All' || query.language === language))
          || (change.postId && feed.items.some(post => post._id === change.postId)))) {
          try { localStorage.removeItem(key); }
          catch { if (requireAcknowledgement) throw new Error('Post saved; cache acknowledgement needs recovery.'); }
        }
      } catch (error) { if (requireAcknowledgement && error instanceof Error && error.message === 'Post saved; cache acknowledgement needs recovery.') throw error; }
    }
  } catch (error) { if (requireAcknowledgement) throw error; }
}
export function communityNetworkFailure(error: unknown): boolean {
  const failure = error as { response?: unknown; request?: unknown; code?: string } | null;
  return !!failure && !failure.response && (!!failure.request || ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(failure.code || ''));
}
