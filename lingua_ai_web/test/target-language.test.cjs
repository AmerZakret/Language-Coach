const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const calls = [], modules = new Map();
  const client = Object.fromEntries(['post', 'get', 'patch', 'delete'].map(method => [method,
    async (...args) => { calls.push({ method, args }); return { data: args[0].includes('/community/')
      ? (method === 'get' ? { items: [{ learningLanguage: 'de' }] } : { learningLanguage: 'de' }) : [] }; }]));
  function load(file) {
    file = resolve(__dirname, '../src', file);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, FormData, Blob,
      require: name => {
        if (name.endsWith('/apiClient')) return { __esModule: true, default: client };
        if (name.endsWith('/queueSession')) return { getSessionRequestConfig: () => ({ sessionSnapshot: { userId: 'owner' } }) };
        if (name === 'axios') return require('axios');
        const target = resolve(dirname(file), name) + '.ts';
        if (!existsSync(target)) throw new Error(`Unexpected import ${name}`);
        return load(target);
      },
    });
    return module.exports;
  }
  return { load, calls };
}
const languages = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic' };
const locales = { en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA' };
for (const [code, name] of Object.entries(languages)) {
  test(`${code} and ${name} normalize without changing display labels`, () => {
    const { load } = harness(); const language = load('utils/targetLanguage.ts');
    for (const value of [code, name, ` ${name.toUpperCase()} `]) {
      assert.equal(language.targetLanguageCode(value), code);
      assert.equal(language.targetLanguageName(value), name);
      assert.equal(language.targetLanguageTtsLocale(value), locales[code]);
    }
  });
  test(`${name} requests use canonical ${code} across API helpers and flashcard serializer`, async () => {
    const h = harness(), coach = h.load('api/aiCoachApi.ts');
    await coach.sendMessage({ message: 'Hello', language: 'en', targetLanguage: name });
    await coach.checkWriting({ topic: 'Greeting', text: 'Hello', language: 'en', targetLanguage: name });
    await coach.getChatHistory(name); await coach.clearChatHistory(name);
    await h.load('api/authApi.ts').updateProfile({ targetLanguage: name });
    await h.load('api/progressApi.ts').fetchProgress('owner', name);
    await h.load('api/lessonsApi.ts').getLessons(name);
    await h.load('api/pronunciationApi.ts').assessPronunciation({ audio: new Blob(['fixture']), targetText: 'word', targetLanguage: name });
    const post = new FormData(); post.set('learningLanguage', name); post.set('text', 'word');
    await h.load('api/communityApi.ts').createCommunityPost(post);
    for (const { args } of h.calls) {
      if (args[0].startsWith('/lessons?')) assert.equal(args[0], `/lessons?targetLanguage=${code}`);
      else if (args[1] instanceof FormData) assert.equal(args[1].get(args[0].includes('/community/') ? 'learningLanguage' : 'targetLanguage'), code);
      else assert.equal(args[1]?.targetLanguage ?? args[1]?.params?.targetLanguage, code);
    }
    assert.equal(h.load('utils/flashcardMutation.ts').serializeFlashcardMutation({ targetLanguage: name, note: '' }).targetLanguage, code);
    const feed = await h.load('api/communityApi.ts').getCommunityPosts({ language: name });
    assert.equal(h.calls.at(-1).args[1].params.language, code);
    assert.equal(feed.items[0].learningLanguage, 'German');
  });
}
test('unknown values reject explicitly before any mutation or pronunciation transport', async () => {
  const h = harness(), language = h.load('utils/targetLanguage.ts');
  for (const value of ['unknown', 'tr', 'Turkish', '', null, 12]) {
    assert.equal(language.tryTargetLanguageCode(value), undefined);
    assert.throws(() => language.targetLanguageCode(value), /Unsupported target language/);
    assert.throws(() => language.targetLanguageTtsLocale(value), /Unsupported target language/);
  }
  await assert.rejects(h.load('api/aiCoachApi.ts').sendMessage({ targetLanguage: 'unknown' }), /Unsupported target language/);
  await assert.rejects(h.load('api/pronunciationApi.ts').assessPronunciation({ audio: new Blob(['fixture']), targetText: 'word', targetLanguage: 'unknown' }), /Unsupported target language/);
  assert.equal(h.calls.length, 0);
});
