module.exports = {
  rootDir: '../../lingua_ai_backend/src',
  testRegex: 'application-postgres.integration.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleDirectories: ['/opt/m3a/node_modules'],
  transform: { '^.+\\.ts$': require.resolve('ts-jest') },
  testEnvironment: 'node',
};
