const assert = require('node:assert/strict');
const { test } = require('node:test');
const { origin, user, A, B, deferred } = require('./helpers/browserContexts.cjs');

for (const operation of ['create', 'edit', 'delete', 'reaction', 'send', 'clear']) {
  test(`7E ${operation}: uncertain acknowledgement retries original key, payload and credentials`, async () => {
    const o = origin(), tab = o.tab(); await tab.install(user(A));
    const api = tab.load(operation === 'send' || operation === 'clear' ? 'api/aiCoachApi.ts' : 'api/communityApi.ts');
    let attempts = 0;
    tab.dispatch = async req => {
      if (++attempts === 1) throw { response: { status: 503 }, config: req };
      return { data: { _id: 'post', learningLanguage: 'en', likesCount: 8, likedByMe: true, reply: 'reply' } };
    };
    const form = new FormData(); form.set('learningLanguage', 'en'); form.set('text', 'post'); form.set('expectedRevision', '3');
    const mutate = key => operation === 'create' ? api.createCommunityPost(form, key)
      : operation === 'edit' ? api.updateCommunityPost('post', form, key)
      : operation === 'delete' ? api.deleteCommunityPost('post', 3, key)
      : operation === 'reaction' ? api.toggleLikeCommunityPost('post', true, key)
      : operation === 'send' ? api.sendMessage({ message: 'hello', language: 'en', targetLanguage: 'de' }, key)
      : api.clearChatHistory('de', key);
    const result = await mutate('original-key');
    assert.equal(tab.requests.length, 2);
    for (const req of tab.requests) {
      assert.equal(req.headers['X-Idempotency-Key'], 'original-key');
      assert.equal(req.headers.Authorization, `Bearer token-${A}`);
    }
    assert.deepEqual(tab.requests[0].data, tab.requests[1].data);
    if (operation === 'reaction') { assert.deepEqual(JSON.parse(JSON.stringify(tab.requests[0].data)), { liked: true }); assert.equal(result.likesCount, 8); }
    if (operation === 'delete') assert.equal(tab.requests[0].headers['X-Resource-Revision'], 3);
    await mutate(); await mutate();
    assert.notEqual(tab.requests.at(-1).headers['X-Idempotency-Key'], tab.requests.at(-2).headers['X-Idempotency-Key']);
  });
}

test('7E retry stops after owner replacement and never adopts B credentials', async () => {
  const o = origin(), tab = o.tab(); await tab.install(user(A));
  const pending = deferred(), started = deferred();
  tab.dispatch = req => { started.resolve(); return pending.promise; };
  const work = tab.load('api/aiCoachApi.ts').sendMessage({ message: 'A', language: 'en', targetLanguage: 'en' }, 'A-send');
  const rejection = assert.rejects(work);
  await started.promise; await tab.install(user(B));
  pending.reject({ response: { status: 503 }, config: tab.requests[0] });
  await rejection;
  assert.equal(tab.requests.length, 1);
  assert.equal(tab.requests[0].headers.Authorization, `Bearer token-${A}`);
});

test('7E current 401 retains existing invalidation behavior without a transport retry', async () => {
  const o = origin(), tab = o.tab(); await tab.install(user(A));
  tab.dispatch = async req => { throw { response: { status: 401 }, config: req }; };
  await assert.rejects(tab.load('api/communityApi.ts').toggleLikeCommunityPost('post', true, 'unauthorized'));
  assert.equal(tab.requests.length, 1);
  assert.equal(tab.session.getOfflineQueueSession().ownerNamespace, 'local_guest');
});


test('7E same-device opposite reactions dispatch in user intent order', async () => {
  const o = origin(), tab = o.tab(); await tab.install(user(A));
  const firstAck = deferred(), firstStarted = deferred();
  tab.dispatch = async req => {
    if (req.data.liked) { firstStarted.resolve(); await firstAck.promise; }
    return { data: { likesCount: req.data.liked ? 1 : 0, likedByMe: req.data.liked } };
  };
  const api = tab.load('api/communityApi.ts');
  const like = api.toggleLikeCommunityPost('post', true, 'on');
  await firstStarted.promise;
  const unlike = api.toggleLikeCommunityPost('post', false, 'off');
  await Promise.resolve(); assert.equal(tab.requests.length, 1);
  firstAck.resolve();
  await like; assert.equal((await unlike).likedByMe, false);
  assert.deepEqual(tab.requests.map(req => req.data.liked), [true, false]);
});
