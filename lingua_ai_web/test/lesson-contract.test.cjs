const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const axios = require('axios');
const root = resolve(__dirname, '../..');
const tick = () => new Promise(done => setImmediate(done));

// Execute actual helpers, fallback data and page render branches without a DOM.
function harness() {
  const modules = new Map();
  const slots = [];
  const pending = [];
  const completed = [];
  let cursor = 0;
  let dirty = true;
  const h = { id: 'en_b_1', language: 'English', calls: [], completed };
  const react = {
    useState: initial => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        pending.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
    }).outputText, { module, exports: module.exports, console: { error() {} },
      require: name => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react-router-dom') return { useParams: () => ({ id: h.id }), useNavigate: () => () => {} };
        if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => name });
        if (name === 'axios') return axios;
        if (name.endsWith('/apiClient')) return { __esModule: true, default: {
          get: async url => { h.calls.push(url); return { data: await h.transport(url) }; },
        } };
        if (name.endsWith('/TargetLanguageContext')) return { useTargetLanguage: () => ({ targetLanguage: h.language }) };
        if (name.endsWith('/ProgressContext')) return { useProgress: () => ({
          progress: { completedLessonIds: completed }, completeLesson: (...args) => h.completed.push(args),
        }) };
        if (name.endsWith('/LanguageContext')) return { useLanguage: () => ({ t: key => key }) };
        if (name.endsWith('/soundService')) return { soundService: { playCorrect() {}, playWrong() {} } };
        const path = resolve(dirname(file), name);
        const resolved = [`${path}.ts`, `${path}.tsx`, resolve(path, 'index.ts')].find(existsSync);
        if (!resolved) throw new Error(`Unexpected import ${name}`);
        return load(resolved);
      },
    });
    return module.exports;
  }
  h.api = load(resolve(root, 'lingua_ai_web/src/api/lessonsApi.ts'));
  h.fallback = load(resolve(root, 'lingua_ai_web/src/data/fallbackLessons.ts')).fallbackLessons;
  h.seed = load(resolve(root, 'lingua_ai_backend/src/lessons/data/index.ts')).allLessons;
  h.transport = async url => url.includes('?') ? h.seed : h.seed.find(lesson => lesson.id === url.split('/').at(-1));
  h.mount = () => {
    h.page = load(resolve(root, 'lingua_ai_web/src/pages/LessonQuizPage.tsx')).LessonQuizPage;
    h.render();
  };
  h.render = () => {
    cursor = 0; dirty = false;
    h.tree = h.page();
    for (const effect of pending.splice(0)) effect();
  };
  h.settle = async () => {
    for (let i = 0; i < 8; i++) { await tick(); if (dirty) h.render(); }
  };
  h.text = () => {
    function text(node) {
      if (node == null) return '';
      if (typeof node !== 'object') return String(node);
      if (Array.isArray(node)) return node.map(text).join(' ');
      return text(node.props?.children);
    }
    return text(h.tree);
  };
  return h;
}

function missing() {
  return new axios.AxiosError('Lesson not found', 'ERR_BAD_REQUEST', undefined, undefined,
    { status: 404, data: { message: 'Lesson not found', error: 'Not Found', statusCode: 404 } });
}

for (const [label, code] of Object.entries({ English: 'en', German: 'de', Spanish: 'es', French: 'fr', Arabic: 'ar' })) {
  test(`${label} fallback IDs resolve against actual seed data and retain API codes`, async () => {
    const h = harness();
    const fallback = h.fallback.filter(lesson => lesson.targetLanguage === code);
    assert.equal(fallback.length, 6);
    assert.equal(new Set(fallback.map(lesson => lesson.id)).size, 6);
    for (const lesson of fallback) {
      assert.equal(h.seed.find(seed => seed.id === lesson.id)?.targetLanguage, code);
      assert.ok(lesson.questions.length > 0);
      assert.equal((await h.api.getLessonById(lesson.id)).id, lesson.id);
    }
    const summaries = await h.api.getLessons(label);
    assert.ok(h.calls.includes(`/lessons?targetLanguage=${code}`));
    assert.ok(summaries.every(lesson => ['en', 'de', 'es', 'fr', 'ar'].includes(lesson.targetLanguage)));
  });
}

test('404 is explicit and the page does not substitute a known fallback', async () => {
  const h = harness();
  h.transport = async () => { throw missing(); };
  await assert.rejects(h.api.getLessonById(h.id), h.api.LessonNotFoundError);
  h.mount(); await h.settle();
  assert.match(h.text(), /lesson_unavailable/);
  assert.match(h.text(), /back_to_lessons/);
  assert.equal(h.completed.length, 0);
});

test('unknown 404 navigation cannot retain the previous valid lesson', async () => {
  const h = harness();
  h.mount(); await h.settle();
  assert.doesNotMatch(h.text(), /lesson_unavailable/);
  h.id = 'missing'; h.transport = async () => { throw missing(); };
  h.render(); await h.settle();
  assert.match(h.text(), /lesson_unavailable/);
});

test('transport failure uses the exact playable fallback and never an unrelated lesson', async () => {
  const h = harness();
  h.transport = async () => { throw new Error('offline'); };
  h.mount(); await h.settle();
  assert.doesNotMatch(h.text(), /lesson_unavailable/);
  assert.match(h.text(), /Merhaba/);
  h.id = 'missing'; h.render(); await h.settle();
  assert.match(h.text(), /lesson_unavailable/);
});

test('successful error wrappers and display-name language values are rejected as details', async () => {
  const h = harness();
  for (const body of [{ error: 'Lesson not found', id: h.id },
    { ...h.seed[0], targetLanguage: 'English' }, { ...h.seed[0], id: 'wrong' }]) {
    h.transport = async () => body;
    await assert.rejects(h.api.getLessonById(h.id), /Invalid lesson/);
  }
});

test('empty questions use the existing unavailable UI without indexing', async () => {
  const h = harness();
  h.transport = async url => url.includes('?') ? h.seed : { ...h.seed[0], questions: [] };
  h.mount(); await h.settle();
  assert.match(h.text(), /no_questions_found/);
  assert.equal(h.completed.length, 0);
});
