// validation.js — zod schemas for every API request shape, plus a tiny
// middleware factory that runs them. Keeps marketService.js free of
// "is this a string?" defensive checks.
const { z } = require('zod')
const { ValidationError } = require('./errors')

// --- Primitives ------------------------------------------------------------
const handle = z
  .string()
  .trim()
  .min(1, 'handle required')
  .max(40)
  .regex(/^[A-Za-z0-9_.-]+$/, 'handle: letters, digits, _ . - only')

const idParam = z.coerce.number().int().nonnegative()

// Accept ISO 8601 strings or epoch millis.
const futureTime = z
  .union([z.coerce.number().int(), z.string().datetime()])
  .transform(v => (typeof v === 'number' ? v : Date.parse(v)))
  .refine(v => Number.isFinite(v) && v > Date.now(), 'endTime must be in the future')

// --- Body schemas ----------------------------------------------------------
// owner comes from req.user — not the request body — so we don't accept it.
const createMarketBody = z.object({
  description: z.string().trim().min(8).max(280),
  endTime: futureTime,
  outcomes: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
  category: z.string().trim().min(1).max(40).default('Other'),
  resolutionSource: z.string().trim().max(500).default(''),
  imageUrl: z.string().url().nullable().optional(),
  liquidityB: z.number().positive().max(1e6).default(500),
  useLsLmsr: z.boolean().default(false),
  lsAlpha: z.number().positive().max(1).default(0.05),
})

// `user` is no longer accepted from the client — the server reads the
// authenticated user from the session cookie. These bodies only carry
// the action-specific parameters.
const tradeBody = z.object({
  outcome: z.coerce.number().int().nonnegative(),
  chips: z.coerce.number().positive().max(1e6),
})

const previewBody = z.object({
  outcome: z.coerce.number().int().nonnegative(),
  chips: z.coerce.number().positive().max(1e6),
})

const sellBody = z.object({
  outcome: z.coerce.number().int().nonnegative(),
  shares: z.coerce.number().positive().max(1e9),
})

const previewSellBody = z.object({
  outcome: z.coerce.number().int().nonnegative(),
  shares: z.coerce.number().positive().max(1e9),
})

const proposeBody = z.object({
  outcome: z.coerce.number().int().nonnegative(),
})

const disputeBody = z.object({}).optional().default({})

const finalizeBody = z.object({
  outcome: z.coerce.number().int().nonnegative().optional(),
})

const claimBody = z.object({}).optional().default({})

// --- Auth ------------------------------------------------------------------
const password = z.string().min(8, 'Password must be at least 8 characters').max(200)

const registerBody = z.object({
  handle,
  password,
  email: z.string().email().max(254).optional(),
})

const loginBody = z.object({
  handle,
  password: z.string().min(1).max(200),
})

// Google ID tokens are JWTs — three base64url segments separated by dots,
// well under 4 KB in practice. Cap at 8 KB defensively.
const googleAuthBody = z.object({
  idToken: z.string().min(20).max(8192),
})

// --- Query schemas ---------------------------------------------------------
const listMarketsQuery = z.object({
  category: z.string().trim().max(40).optional(),
  // Discovery sorts. 'new' is the historical default (createdAt desc, all
  // statuses). 'trending' and 'ending' return LIVE markets only.
  sort: z.enum(['new', 'trending', 'ending']).default('new'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const leaderboardQuery = z.object({
  by: z.enum(['balance', 'pas', 'pnl', 'streak']).default('balance'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const calibrationQuery = z.object({
  bins: z.coerce.number().int().min(2).max(50).default(10),
})

const transactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// --- Param schemas ---------------------------------------------------------
const marketIdParams = z.object({
  id: idParam,
})

const userParams = z.object({
  user: handle,
})

const userMarketParams = z.object({
  id: idParam,
  user: handle,
})

// --- Middleware factory ----------------------------------------------------
// Each schema is run separately so error messages are scoped (`body.outcome`
// vs `params.id`). zod's flatten() output goes into err.details.
function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (params) req.params = parseOrThrow(params, req.params, 'params')
      if (query) req.query = parseOrThrow(query, req.query, 'query')
      if (body) req.body = parseOrThrow(body, req.body, 'body')
      next()
    } catch (e) {
      next(e)
    }
  }
}

function parseOrThrow(schema, value, where) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const flat = result.error.flatten()
    throw new ValidationError(`Invalid ${where}`, {
      where,
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
    })
  }
  return result.data
}

module.exports = {
  validate,
  schemas: {
    createMarketBody,
    tradeBody,
    sellBody,
    previewBody,
    previewSellBody,
    proposeBody,
    disputeBody,
    finalizeBody,
    claimBody,
    registerBody,
    loginBody,
    googleAuthBody,
    listMarketsQuery,
    leaderboardQuery,
    calibrationQuery,
    transactionsQuery,
    marketIdParams,
    userParams,
    userMarketParams,
  },
}
