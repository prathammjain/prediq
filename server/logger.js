// logger.js — tiny structured logger. JSON one-line in production (for log
// aggregators), human-readable in dev. No external dependency.
//
// Usage:
//   const log = require('./logger')
//   log.info('boot', { port: 3000 })
//   log.error('grading failed', { marketId: 42, err })
//
// Fields that are Error instances are serialised to { name, message, stack }.

const { env } = require('./config')

function serialise(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  return value
}

function emit(level, msg, fields) {
  const ts = new Date().toISOString()
  const record = { ts, level, msg }
  if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields)) record[k] = serialise(v)
  }
  if (env.isProduction) {
    // Single-line JSON for log shippers (Datadog, Loki, CloudWatch, etc.)
    process.stdout.write(JSON.stringify(record) + '\n')
  } else if (env.isTest) {
    // Stay silent in tests — Jest captures console output anyway.
    if (level === 'error') process.stderr.write(`[${level}] ${msg}\n`)
  } else {
    // Pretty for the dev terminal.
    const tail = fields && Object.keys(fields).length
      ? ' ' + Object.entries(record)
          .filter(([k]) => k !== 'ts' && k !== 'level' && k !== 'msg')
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ')
      : ''
    const prefix = level === 'error' ? '\x1b[31merror\x1b[0m'
      : level === 'warn' ? '\x1b[33mwarn\x1b[0m'
      : level === 'info' ? '\x1b[36minfo\x1b[0m'
      : level
    process.stdout.write(`${prefix} ${msg}${tail}\n`)
  }
}

module.exports = {
  info:  (msg, fields) => emit('info', msg, fields),
  warn:  (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  debug: (msg, fields) => emit('debug', msg, fields),
}
