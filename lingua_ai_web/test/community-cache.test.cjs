const { test } = require('node:test');
const assert = require('node:assert/strict');
const { origin, A, B, user } = require('./helpers/browserContexts.cjs');
const feed = id => ({ items: [{ _id: 'post', userId: id, userName: 'Name', learningLanguage: 'English',
  likes: [id], likesCount: 1, likedByMe: true, createdAt: '', updatedAt: '' }], page: 1, limit: 50, total: 1, hasMore: false });

test('registered/backend guest/local_guest cache isolation, canonical queries and switch back', async () => {
  const shared = origin(), tab = shared.tab();
  const cache = tab.load('utils/communityFeedCache.ts');
  const a = cache.communityQuery(`registered_${A}`, 'English');
  cache.writeCommunityFeed(a, feed(A));
  for (const owner of [`registered_${B}`, `guest_${A}`, 'local_guest']) {
    assert.equal(cache.readCommunityFeed(cache.communityQuery(owner, 'en')), undefined);
  }
  assert.equal(cache.readCommunityFeed(cache.communityQuery(`registered_${A}`, 'en')).items[0].likedByMe, true);
  for (const query of [cache.communityQuery(`registered_${A}`, 'de'), cache.communityQuery(`registered_${A}`, 'en', 2),
    cache.communityQuery(`registered_${A}`, 'en', 1, 10)]) assert.equal(cache.readCommunityFeed(query), undefined);
});

test('legacy, mismatched envelopes and malformed payloads are unavailable; valid empty is distinct', () => {
  const tab = origin().tab(), cache = tab.load('utils/communityFeedCache.ts');
  const query = cache.communityQuery(`registered_${A}`), key = cache.communityCacheKey(query);
  tab.localStorage.setItem('linguaai_community_feed_All', JSON.stringify(feed(A).items));
  assert.equal(cache.readCommunityFeed(query), undefined);
  cache.writeCommunityFeed(query, feed(A));
  const valid = JSON.parse(tab.localStorage.getItem(key));
  for (const change of [{ ownerNamespace: `registered_${B}` }, { schemaVersion: 1 }, { language: 'de' },
    { page: 2 }, { limit: 10 }, { payload: {} }, { payload: { ...feed(A), items: [null] } }]) {
    tab.localStorage.setItem(key, JSON.stringify({ ...valid, ...change }));
    assert.equal(cache.readCommunityFeed(query), undefined);
  }
  tab.localStorage.setItem(key, '{broken'); assert.equal(cache.readCommunityFeed(query), undefined);
  cache.writeCommunityFeed(query, { ...feed(A), items: [], total: 0 });
  assert.equal(cache.readCommunityFeed(query).items.length, 0);
});

for (const change of [{ language: 'en' }, { postId: 'post', language: 'en' }, { postId: 'post' }]) {
  test(`mutation invalidation is owner and affected-query scoped: ${JSON.stringify(change)}`, () => {
    const tab = origin().tab(), cache = tab.load('utils/communityFeedCache.ts');
    const a = `registered_${A}`, b = `registered_${B}`;
    const affected = cache.communityQuery(a, 'en'), all = cache.communityQuery(a), other = cache.communityQuery(a, 'de');
    cache.writeCommunityFeed(affected, feed(A)); cache.writeCommunityFeed(all, feed(A));
    cache.writeCommunityFeed(other, { ...feed(A), items: [{ ...feed(A).items[0], _id: 'unrelated' }] });
    cache.writeCommunityFeed(cache.communityQuery(b, 'en'), feed(B));
    cache.invalidateCommunityFeed(a, change);
    assert.equal(cache.readCommunityFeed(affected), undefined); assert.equal(cache.readCommunityFeed(all), undefined);
    assert.ok(cache.readCommunityFeed(other)); assert.ok(cache.readCommunityFeed(cache.communityQuery(b, 'en')));
  });
}

test('real atomic cross-tab session changes choose new namespace; 401 invalidates before fallback', async () => {
  const shared = origin(), first = shared.tab(), second = shared.tab();
  await first.mount(); await second.mount(); await first.install(user(A));
  const cache = first.load('utils/communityFeedCache.ts');
  cache.writeCommunityFeed(cache.communityQuery(first.session.getOfflineQueueSession().ownerNamespace), feed(A));
  await second.install(user(B)); await shared.flush();
  assert.equal(first.session.getOfflineQueueSession().ownerNamespace, `registered_${B}`);
  assert.equal(cache.readCommunityFeed(cache.communityQuery(first.session.getOfflineQueueSession().ownerNamespace)), undefined);
  await first.install(user(A));
  first.dispatch = async () => { throw { response: { status: 401 } }; };
  await assert.rejects(first.client.get('/community/posts'));
  await shared.flush();
  assert.equal(first.session.getOfflineQueueSession().ownerNamespace, 'local_guest');
  assert.equal(cache.readCommunityFeed(cache.communityQuery('local_guest')), undefined);
  assert.ok(cache.readCommunityFeed(cache.communityQuery(`registered_${A}`)), 'own cache survives invalidation');
});

test('fallback classifier accepts network errors only', () => {
  const cache = origin().tab().load('utils/communityFeedCache.ts');
  assert.equal(cache.communityNetworkFailure({ code: 'ERR_NETWORK' }), true);
  for (const e of [{ response: { status: 401 } }, { response: { status: 503 } }, new Error('malformed')])
    assert.equal(cache.communityNetworkFailure(e), false);
});
