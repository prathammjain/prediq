// Jest config for predIQ.
//
// • setupFiles runs BEFORE any test file's `require()` — that's where we
//   set DATABASE_URL so the Prisma singleton in server/marketService.js
//   picks up a worker-specific test database.
// • testTimeout is generous because the integration suite runs `prisma db
//   push` in beforeAll, which can take a few seconds on a cold node_modules.

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 30000,
}
