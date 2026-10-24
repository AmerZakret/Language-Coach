const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

// Real React and DOM reconciliation; only application contexts and transports
// are fixtures. Keep the existing VM/Web Locks suites for storage interleavings.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.example.invalid' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(offline = false) {
  const Network = React.createContext({ isOffline: offline });
  const user = { id: '507f1f77bcf86cd799439011' };
  const requests = [], assessments = [], errors = [], modules = new Map();
  let respond = async () => ({ data: [{ _id: 'card', targetWord: 'Hello world', turkishTranslation: 'Merhaba' }] });
  const mocks = {
    '../context/AuthContext': { useAuth: () => ({ user }) },
    '../context/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    '../context/TargetLanguageContext': { useTargetLanguage: () => ({ targetLanguage: 'English' }) },
    '../context/NetworkContext': { useNetwork: () => React.useContext(Network) },
    '../api/apiClient': { __esModule: true, default: { get: async url => { requests.push(url); return respond(url); } } },
    '../api/pronunciationApi': { assessPronunciation: async args => { assessments.push(args); throw new Error('Unexpected provider work'); } },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, Blob, URL, setInterval, clearInterval, console,
      require: name => mocks[name] || (name.startsWith('.') ? load(resolve(dirname(file), `${name}.ts`)) : require(name)),
    }, { filename: file });
    return module.exports;
  }
  const { PronunciationPracticePage } = load(resolve(__dirname, '../src/pages/PronunciationPracticePage.tsx'));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container, { onUncaughtError: error => errors.push(error), onCaughtError: error => errors.push(error) });
  return { container, requests, assessments, errors,
    respond: fn => { respond = fn; },
    render: async value => { await act(async () => { root.render(React.createElement(Network.Provider,
      { value: { isOffline: value } }, React.createElement(PronunciationPracticePage))); }); },
    click: async text => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === text);
      assert.ok(button, `Missing ${text} button`); await act(async () => button.click()); },
    close: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

test('9B real React: online -> offline -> online preserves hook order and practice state', async () => {
  const h = fixture(); const diagnostics = [];
  const originalError = console.error; console.error = (...args) => diagnostics.push(args.join(' '));
  try {
    await h.render(false); assert.equal(h.requests.length, 1);
    await h.click('from_flashcards'); await h.click('Hello worldMerhaba');
    assert.match(h.container.textContent, /practice_phrase/);
    await h.render(true);
    assert.match(h.container.textContent, /offline_only_title/);
    assert.equal(h.container.querySelectorAll('button').length, 0);
    assert.equal(h.requests.length, 1); assert.equal(h.assessments.length, 0);
    await h.render(false);
    assert.equal(h.requests.length, 2);
    assert.match(h.container.querySelector('h2').textContent, /Hello world/);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(diagnostics, [], 'no hook-order/runtime/act diagnostics');
  } finally { await h.close(); console.error = originalError; }
});

test('9B real React: initial offline render performs no network work; stale source response is ignored', async () => {
  const h = fixture(true), pending = deferred();
  try {
    await h.render(true); assert.equal(h.requests.length, 0);
    h.respond(() => pending.promise);
    await h.render(false); assert.equal(h.requests.length, 1);
    await h.render(true);
    await act(async () => pending.resolve({ data: [{ _id: 'stale', targetWord: 'Stale', turkishTranslation: 'old' }] }));
    assert.equal(h.assessments.length, 0);
    h.respond(async () => ({ data: [] })); await h.render(false); await h.click('from_flashcards');
    assert.match(h.container.textContent, /no_flashcards_available/);
    assert.doesNotMatch(h.container.textContent, /Stale/); assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
