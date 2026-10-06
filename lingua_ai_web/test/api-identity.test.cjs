const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('AI and pronunciation helpers omit body/query identity and keep active routes', async () => {
  const calls = [];
  const client = Object.fromEntries(['post', 'get', 'delete'].map(method => [method,
    async (...args) => { calls.push({ method, args }); return { data: {} }; }]));
  function load(file) {
    const module = { exports: {} };
    const source = readFileSync(join(__dirname, '../src/api', file), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, FormData, Blob,
      require: name => {
        if (name === './apiClient') return { __esModule: true, default: client };
        throw new Error(`Unexpected import ${name}`);
      } });
    return module.exports;
  }
  const coach = load('aiCoachApi.ts');
  await coach.sendMessage({ message: 'Hello', language: 'en', targetLanguage: 'English' });
  await coach.checkWriting({ topic: 'Greetings', text: 'Hello', language: 'en', targetLanguage: 'English' });
  await coach.getChatHistory('English');
  await coach.clearChatHistory('English');
  await load('pronunciationApi.ts').assessPronunciation({
    audio: new Blob(['fixture']), targetText: 'Hello', targetLanguage: 'en',
  });
  assert.deepEqual(calls.map(call => [call.method, call.args[0]]), [
    ['post', '/ai-coach/chat'], ['post', '/ai-coach/writing-check'],
    ['get', '/ai-coach/history'], ['delete', '/ai-coach/clear'], ['post', '/pronunciation/assess'],
  ]);
  for (const { method, args } of calls) {
    const body = args[1];
    if (body instanceof FormData) assert.equal(body.has('userId'), false);
    else if (method === 'post') assert.equal('userId' in body, false);
    else assert.equal('userId' in body.params, false);
  }
});
