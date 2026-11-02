const assert = require('node:assert/strict');
const { test } = require('node:test');
const axios = require('axios');

test('11A-R3 patched Axios preserves browser-style auth, timeline and native multipart dispatch', async () => {
  const sent = [];
  const client = axios.create({
    timeout: 45_000,
    headers: { 'Content-Type': 'application/json' },
    adapter: async config => {
      sent.push(config);
      return { config, status: 200, statusText: 'OK', headers: {}, data: { ok: true } };
    },
  });
  const headers = { Authorization: 'Bearer fixture-token', 'X-Data-Timeline': 'fixture-timeline' };
  await client.post('/progress', { lessonId: 'fixture' }, { headers });
  const form = new FormData();
  form.append('audio', new Blob(['fixture'], { type: 'audio/webm' }), 'audio.webm');
  await client.post('/pronunciation/assess', form, {
    headers: { ...headers, 'Content-Type': 'multipart/form-data' },
  });

  assert.equal(sent.length, 2);
  for (const request of sent) {
    assert.equal(request.headers.get('Authorization'), headers.Authorization);
    assert.equal(request.headers.get('X-Data-Timeline'), headers['X-Data-Timeline']);
    assert.equal(request.timeout, 45_000);
  }
  assert.equal(JSON.parse(sent[0].data).lessonId, 'fixture');
  assert.equal(sent[1].data, form);
  assert.match(sent[1].headers.get('Content-Type'), /^multipart\/form-data/);
});
