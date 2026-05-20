// Per-worker DATABASE_URL bootstrap. Runs before any test file's requires
// so server/marketService.js (which instantiates PrismaClient at import
// time) sees the correct URL.
const path = require('path')

if (!process.env.DATABASE_URL || /dev\.db/.test(process.env.DATABASE_URL)) {
  const worker = process.env.JEST_WORKER_ID || '1'
  const file = path.resolve(__dirname, '..', 'prisma', `test-w${worker}.db`)
  process.env.DATABASE_URL = `file:${file}`
}
