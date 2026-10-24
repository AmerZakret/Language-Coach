// Language/writing/identity unit fixtures isolate the recovery boundary.
// intent-recovery.test.cjs exercises the actual journal, locks and HTTP client.
exports.isolatedIntentBoundary = client => ({
  recoverOnlineIntents: async () => {},
  recoverBeforeRead: async () => {},
  communityCreatePayload: async form => Object.fromEntries(form),
  durableMutation: async (kind, language, payload) => {
    if (kind === 'ai-send') return (await client.post('/ai-coach/chat', payload)).data;
    if (kind === 'ai-clear') return (await client.delete('/ai-coach/clear', { params: payload })).data;
    const form = new FormData();
    for (const [key, value] of Object.entries(payload)) form.set(key, value);
    return (await client.post('/community/posts', form)).data;
  },
});
