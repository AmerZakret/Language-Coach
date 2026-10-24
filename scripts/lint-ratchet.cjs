const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync, mkdtempSync, symlinkSync, copyFileSync, rmSync } = require('node:fs');
const { resolve, relative, join, dirname, basename } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '..');
// Reviewed 9A baseline. Compare source diagnostics, not a suppression/count file.
// CI fetches this history; a missing baseline fails closed.
const BASE = 'cd0d28bf108186466ef3fede14de6778cf44159d';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
function fingerprints(result, source) {
  const lines = source.split(/\r?\n/);
  return result.messages.map(message => ({ message, key: JSON.stringify([message.ruleId, message.severity,
    message.message.split('\n')[0], lines[(message.line || 1) - 1]?.trim()]) }));
}
function novel(current, previous) {
  const remaining = new Map();
  for (const entry of previous) remaining.set(entry.key, (remaining.get(entry.key) || 0) + 1);
  return current.filter(entry => { const count = remaining.get(entry.key) || 0;
    if (count) { remaining.set(entry.key, count - 1); return false; } return true; });
}
function productionGraph() {
  const ts = require('../lingua_ai_web/node_modules/typescript');
  const cwd = resolve(root, 'lingua_ai_web'); const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return; seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const entry of source.statements) if (ts.isImportDeclaration(entry) || ts.isExportDeclaration(entry)) {
      const name = entry.moduleSpecifier?.text; if (!name) continue;
      const imported = ts.resolveModuleName(name, file, { moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true, jsx: ts.JsxEmit.ReactJSX }, ts.sys).resolvedModule?.resolvedFileName;
      if (imported && !imported.includes('/node_modules/') && !imported.includes('\\node_modules\\') && !imported.endsWith('.d.ts')) visit(imported);
    }
  };
  visit(resolve(cwd, 'src/main.tsx'));
  if ([...seen].some(file => /[\\/]new_components[\\/]/.test(file))) throw new Error('Prototype code entered production graph; remove its type/lint exclusions before release.');
  console.log(`Production graph: ${seen.size} source modules; new_components is PROTOTYPE_REFERENCE (zero imports).`);
}
function baselineTree(component) {
  const temporary = mkdtempSync(join(tmpdir(), 'lingua-lint-'));
  const cleanup = () => {
    if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('lingua-lint-')) throw new Error('Unsafe lint fixture cleanup path.');
    rmSync(temporary, { recursive: true, force: true });
  };
  try {
    const archive = execFileSync('git', ['archive', '--format=tar', BASE, `lingua_ai_${component}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
    const cwd = join(temporary, `lingua_ai_${component}`);
    symlinkSync(join(root, `lingua_ai_${component}`, 'node_modules'), join(cwd, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    // The same current rules/toolchain evaluate both trees. Only source/program
    // context differs; never lint old text against the current TS type graph.
    const config = component === 'backend' ? 'eslint.config.mjs' : 'eslint.config.js';
    copyFileSync(join(root, `lingua_ai_${component}`, config), join(cwd, config));
    return { cwd, cleanup };
  } catch (error) { cleanup(); throw error; }
}
async function main(component) {
  if (!['backend', 'web'].includes(component)) throw new Error('Select backend or web.');
  const cwd = resolve(root, `lingua_ai_${component}`);
  const { ESLint } = require(resolve(cwd, 'node_modules/eslint'));
  const eslint = new ESLint({ cwd, fix: false });
  git(['cat-file', '-e', `${BASE}^{commit}`]);
  const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', `lingua_ai_${component}`]).split('\0')
    .filter(file => /\.(ts|tsx)$/.test(file) && existsSync(resolve(root, file)) && !file.includes('/new_components/'));
  const baselineFiles = new Set(git(['ls-tree', '-r', '--name-only', BASE, '--', `lingua_ai_${component}`]).trim().split('\n'));
  const changedFiles = new Set(git(['diff', '--name-only', BASE, '--', `lingua_ai_${component}`]).trim().split('\n'));
  let errors = 0, warnings = 0, newIssues = 0;
  const baseline = baselineTree(component);
  try {
    const historicalPaths = paths.filter(file => baselineFiles.has(file) && changedFiles.has(file))
      .map(file => resolve(baseline.cwd, relative(cwd, resolve(root, file))));
    // Type-aware parsers share a project service within a process. Evaluate the
    // historical program in its own process so opening old source cannot alter
    // the current program's symbols or produce position-dependent diagnostics.
    const program = `const {ESLint}=require(${JSON.stringify(resolve(cwd, 'node_modules/eslint'))});
      (async()=>{const e=new ESLint({cwd:process.cwd(),fix:false});const results=await e.lintFiles(JSON.parse(process.argv[1]));
      process.stdout.write(JSON.stringify(results.map(r=>({filePath:r.filePath,messages:r.messages}))));})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
    const historical = historicalPaths.length ? JSON.parse(execFileSync(process.execPath, ['-e', program, JSON.stringify(historicalPaths)],
      { cwd: baseline.cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) : [];
    const history = new Map(historical.map(result => [result.filePath, result]));
    const results = await eslint.lintFiles(paths.map(file => resolve(root, file)));
    for (const current of results) {
      const full = current.filePath, file = relative(root, full).replaceAll('\\', '/');
      const source = readFileSync(full, 'utf8');
      errors += current.errorCount; warnings += current.warningCount;
      let previous = [];
      if (baselineFiles.has(file)) {
        if (!changedFiles.has(file)) previous = fingerprints(current, source);
        else {
          const historicalPath = resolve(baseline.cwd, relative(cwd, full));
          const oldResult = history.get(historicalPath);
          if (!oldResult) throw new Error('Missing historical lint result; refusing to grandfather diagnostics.');
          previous = fingerprints(oldResult, readFileSync(historicalPath, 'utf8'));
        }
      }
      for (const { message } of novel(fingerprints(current, source), previous)) {
        newIssues++; console.error(`${file}:${message.line}:${message.column} ${message.ruleId || 'parse'} ${message.message.split('\n')[0]}`);
      }
      const critical = new Set(['no-undef', 'no-unreachable', 'no-async-promise-executor', 'react-hooks/rules-of-hooks']);
      for (const message of current.messages.filter(message => critical.has(message.ruleId))) {
        newIssues++; console.error(`${file}:${message.line} critical: ${message.ruleId}`);
      }
    }
  } finally { baseline.cleanup(); }
  console.log(`${component} read-only lint: ${errors} existing/current errors, ${warnings} warnings; ${newIssues} new or critical diagnostics. Historical debt is NOT clean.`);
  if (component === 'web') productionGraph();
  if (newIssues) throw new Error('Lint regression: fix new diagnostics. No auto-fix was run.');
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { novel, fingerprints, baselineTree };
