// Disposable loopback contract fixture for both clients. No MongoDB or app data.
require('reflect-metadata');
require('ts-node').register({ project: require('node:path').join(__dirname, '../tsconfig.json') });
const { Test } = require('@nestjs/testing');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { ProgressController } = require('../src/progress/progress.controller');
const { ProgressService } = require('../src/progress/progress.service');
const { JwtAuthGuard } = require('../src/auth/jwt-auth.guard');

async function startResetServer() {
  const owner = '507f1f77bcf86cd799439011';
  const secret = randomBytes(32).toString('hex');
  const token = jwt.sign({ sub: owner }, secret, { expiresIn: '5m' });
  const resets = [];
  const module = await Test.createTestingModule({
    controllers: [ProgressController],
    providers: [{ provide: ProgressService, useValue: {
      resetProgress: async (userId, expectedEpoch) => { resets.push(userId); return { userId, progressEpoch: expectedEpoch + 1 }; },
      getUserProgress: async userId => ({ userId, resets }),
    } }],
  }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const payload = jwt.verify(request.headers.authorization?.replace(/^Bearer /, ''), secret);
    request.user = { _id: payload.sub };
    return true;
  } }).compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  return { owner, token, url: `http://127.0.0.1:${address.port}`, resets, close: () => app.close() };
}
module.exports = { startResetServer };
if (require.main === module) {
  startResetServer().then(server => {
    console.log(JSON.stringify({ owner: server.owner, token: server.token, url: server.url }));
    // Closing stdin lets the Flutter test shut down cleanly on every outcome.
    process.stdin.resume();
    process.stdin.on('end', () => { void server.close(); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
