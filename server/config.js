// config.js — boot-time environment validation.
//
// Imported once at startup. Throws with a precise message if the env is
// misconfigured so the process dies before it can serve broken traffic.
// Other modules should `require('./config').env.X` instead of touching
// `process.env` directly — that way the schema is the one source of truth
// for what's wired in.
//
// We DO NOT export the raw process.env; the typed-ish object returned
// here strips unknown keys and normalises types (string → number etc).

const { z } = require('zod')

function buildSchema({ allowMissingDb }) {
  return z.object({
    // --- Runtime --------------------------------------------------------
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // --- Database -------------------------------------------------------
    // Prisma reads DATABASE_URL itself; we validate here so a misconfigured
    // string surfaces at boot rather than on the first query. In test we
    // tolerate the absence (setup.js sets a per-worker path before loading).
    DATABASE_URL: allowMissingDb
      ? z.string().optional()
      : z.string().min(1, 'DATABASE_URL is required (set in .env or platform secrets)'),

  // --- Auth -------------------------------------------------------------
  // Demo bootstrap password. In production we require it to be reasonably
  // long so the seeded accounts aren't trivially guessable.
  DEMO_PASSWORD: z.string().min(8).default('demo1234'),
  GOOGLE_CLIENT_ID: z.string().optional(),

  // --- News pipeline ----------------------------------------------------
  MISTRAL_API_KEY: z.string().optional(),
  NEWS_INGEST_INTERVAL_MIN: z.coerce.number().int().positive().optional(),
  NEWS_DRAFT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).optional(),

    // --- Clustering -----------------------------------------------------
    WEB_CONCURRENCY: z.coerce.number().int().positive().optional(),
  })
}

// Production-only invariants beyond what zod can express on its own field.
function postValidate(env) {
  if (env.NODE_ENV !== 'production') return
  if (env.DEMO_PASSWORD === 'demo1234') {
    throw new ConfigError(
      'DEMO_PASSWORD is still set to the default demo1234 in production. ' +
      'Either set a strong value via env or remove the demo seed step.',
    )
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

function loadConfig() {
  // Determined per-call so tests that flip NODE_ENV between invocations
  // get a fresh schema each time. allowMissingDb covers the `test` mode
  // where setup.js sets DATABASE_URL just-in-time.
  const allowMissingDb = process.env.NODE_ENV === 'test'
  const schema = buildSchema({ allowMissingDb })
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new ConfigError(`Invalid environment:\n${issues}`)
  }
  postValidate(parsed.data)

  // Convenience derived flags — modules read these instead of checking
  // strings, so the surface stays narrow.
  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    isDevelopment: parsed.data.NODE_ENV === 'development',
    hasMistral: !!parsed.data.MISTRAL_API_KEY,
    hasGoogleOAuth: !!parsed.data.GOOGLE_CLIENT_ID,
    newsSchedulerEnabled: !!parsed.data.NEWS_INGEST_INTERVAL_MIN,
  }
}

const env = loadConfig()

module.exports = { env, loadConfig, ConfigError }
