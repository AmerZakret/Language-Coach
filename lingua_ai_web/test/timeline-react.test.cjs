const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { origin, deferred, tick, user } = require('./helpers/browserContexts.cjs');
const { metadata, id: A } = require('./helpers/timelineFixture.cjs');
const B = '22222222-2222-4222-8222-222222222222';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.example.invalid' });
global.window = dom.window; global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');

test('10C real React: offline restart after B discovery hides A profile; B refresh restores current views without clearing auth/evidence', async () => {
  const o = origin({ confirmed: false }), first = o.tab();
  first.fetchCompatibility = async () => ({ ok: true, json: async () => metadata });
  await first.timeline.refresh(); await first.install({ ...user(), name: 'old A profile' });
  await first.load('utils/onlineIntents.ts').prepareOnlineIntent('ai-clear', 'en', { targetLanguage: 'en' });
  first.fetchCompatibility = async () => ({ ok: true, json: async () => ({ ...metadata, dataTimelineId: B }) });
  await first.timeline.refresh(); first.close();
  const tab = o.tab(); tab.navigator.onLine = false;
  tab.fetchCompatibility = async () => { throw new Error('offline'); };
  const profile = deferred(), started = deferred();
  tab.dispatch = async () => { started.resolve(); return profile.promise; };
  const Auth = React.createContext(null), module = { exports: {} };
  const file = resolve(__dirname, '../src/components/TimelineBoundary.tsx');
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, navigator: tab.navigator,
    require: name => name === '../utils/dataTimeline' ? { dataTimeline: tab.timeline }
      : name === '../utils/authSessionStorage' ? tab.authStorage
      : name === '../api/authApi' ? tab.load('api/authApi.ts')
      : name === '../context/AuthContext' ? { useAuth: () => React.useContext(Auth) } : require(name),
  });
  function Harness() {
    const [record, setRecord] = React.useState(() => tab.authStorage.readStoredSession());
    const auth = { ...record, updateUser: async value => {
      await tab.authStorage.replaceStoredSession(value, record.token, record.revision);
      setRecord(tab.authStorage.readStoredSession());
    } };
    return React.createElement(Auth.Provider, { value: auth }, React.createElement(module.exports.TimelineBoundary,
      null, React.createElement('p', null, record.user.name)));
  }
  const container = document.createElement('div'), root = createRoot(container);
  document.body.append(container);
  const key = `linguaai_online_intents_registered_${user().id}`;
  const evidence = o.values.get(key), token = tab.authStorage.readStoredSession().token;
  try {
    await React.act(async () => { root.render(React.createElement(Harness)); await tick(); });
    assert.match(container.textContent, /Connect to confirm current account data/);
    assert.ok(!container.textContent.includes('old A profile'));
    assert.equal(tab.authStorage.readStoredSession().token, token);
    tab.navigator.onLine = true;
    tab.fetchCompatibility = async () => ({ ok: true, json: async () => ({ ...metadata, dataTimelineId: B }) });
    await React.act(async () => { await tab.timeline.refresh(); });
    await started.promise;
    assert.ok(!container.textContent.includes('old A profile'));
    await React.act(async () => { profile.resolve({ data: { ...user(), name: 'current B profile' } }); await tick(); });
    assert.match(container.textContent, /current B profile/);
    assert.equal(tab.authStorage.readStoredSession().profileDataTimelineId, B);
    assert.equal(tab.authStorage.readStoredSession().token, token);
    assert.equal(o.values.get(key), evidence);
    assert.equal(JSON.parse(evidence).intents[0].dataTimelineId, A);
  } finally { await React.act(async () => root.unmount()); tab.close(); container.remove(); }
});

test('10C real React: an old rendered callback cannot adopt B before the component rerenders', async () => {
  const o = origin({ confirmed: false }), tab = o.tab();
  tab.fetchCompatibility = async () => ({ ok: true, json: async () => metadata });
  await tab.timeline.refresh(); await tab.install();
  const module = { exports: {} }, file = resolve(__dirname, '../src/utils/useSessionGuard.ts');
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, localStorage: tab.localStorage,
    require: name => name === './dataTimeline' ? { dataTimeline: tab.timeline } : name === './queueSession' ? tab.session : require(name),
  });
  let oldCallback, writes = 0;
  function Surface() {
    const capture = module.exports.useSessionGuard(`registered_${user().id}`);
    oldCallback = () => { if (capture()()) writes++; };
    return React.createElement('p', null, 'A view');
  }
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(Surface)));
    const saved = oldCallback;
    tab.fetchCompatibility = async () => ({ ok: true, json: async () => ({ ...metadata, dataTimelineId: B }) });
    await tab.timeline.refresh(); saved();
    assert.equal(writes, 0); assert.equal(tab.requests.length, 0);
  } finally { await React.act(async () => root.unmount()); tab.close(); }
});
