// auth.js — server-side session authentication.
//
// Design choices:
//   • Server-side sessions stored in the `Session` table. The cookie value
//     is an opaque random token; only the database knows the user it maps
//     to. This lets us revoke sessions (logout, admin kick) instantly,
//     unlike stateless JWTs.
//   • bcryptjs for password hashing. Pure JS (no native build step), 12
//     rounds — same security profile as bcrypt at typical cost.
//   • HttpOnly cookie — JS on the page cannot read it, mitigating XSS
//     credential theft.
//   • SameSite=Lax — submitting the form from another origin is blocked,
//     mitigating most CSRF without breaking top-level navigations.
//   • 30-day rolling expiry — every authenticated request slides the
//     expiry forward, so active users stay logged in.
//
// The middleware exports two layers:
//   attachUser   — runs on every request, populates req.user (or null)
//   requireAuth  — guard, throws 401 if req.user is null
//   requireAdmin — guard, throws 403 if req.user is not an ADMIN

const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { OAuth2Client } = require('google-auth-library')
const { UnauthorizedError, ForbiddenError, ValidationError } = require('./errors')

const COOKIE_NAME = 'prediq_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const BCRYPT_ROUNDS = 12

// --- Google OAuth -----------------------------------------------------------
// Lazily-built client so a missing GOOGLE_CLIENT_ID doesn't crash startup —
// the /api/auth/google route checks for the env var and returns a clean 503
// when it's absent.
let _googleClient = null
function googleClient() {
  if (!process.env.GOOGLE_CLIENT_ID) return null
  if (!_googleClient) _googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  return _googleClient
}

// Verifies an ID token issued by Google Identity Services. Returns the
// payload ({ sub, email, email_verified, given_name, picture, ... }) on
// success. Throws UnauthorizedError on any verification failure.
async function verifyGoogleIdToken(idToken) {
  const client = googleClient()
  if (!client) throw new UnauthorizedError('Google sign-in not configured')
  if (!idToken || typeof idToken !== 'string') {
    throw new UnauthorizedError('Missing Google ID token')
  }
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    if (!payload?.sub) throw new Error('Token missing subject')
    return payload
  } catch (e) {
    throw new UnauthorizedError('Invalid Google ID token')
  }
}

// Email-derived handles ("alice@gmail.com" → "alice"). Strip non-alphanumerics
// (we permit underscores in handles, but don't manufacture them from emails),
// clamp to 3-20 chars, and append a numeric suffix until unique. Falls back
// to a random handle if the email part is unusable.
async function deriveUniqueHandle(prisma, email) {
  const local = (email || '').split('@')[0] || ''
  let base = local.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (base.length < 3) base = 'player' + crypto.randomBytes(2).toString('hex')
  if (base.length > 16) base = base.slice(0, 16)
  let candidate = base
  for (let i = 0; i < 50; i++) {
    const taken = await prisma.user.findUnique({ where: { handle: candidate }, select: { id: true } })
    if (!taken) return candidate
    candidate = `${base}${Math.floor(Math.random() * 9000) + 1000}`
  }
  // Should never hit; safety fallback.
  return `player${crypto.randomBytes(4).toString('hex')}`
}

// --- Password hashing -------------------------------------------------------
async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new ValidationError('Password must be at least 8 characters')
  }
  if (plain.length > 200) {
    throw new ValidationError('Password too long')
  }
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

async function verifyPassword(plain, hash) {
  if (!hash) return false
  return bcrypt.compare(plain, hash)
}

// --- Session lifecycle ------------------------------------------------------
function newSessionToken() {
  // 32 random bytes = 256 bits of entropy, base64url-encoded for cookie safety.
  return crypto.randomBytes(32).toString('base64url')
}

async function createSession(prisma, { userId, userAgent, ipAddress }) {
  const id = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({
    data: { id, userId, expiresAt, userAgent, ipAddress },
  })
  return { id, expiresAt }
}

async function destroySession(prisma, sessionId) {
  if (!sessionId) return
  await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => {})
}

// Look up the session, return the user object, and slide the expiry
// forward. Returns null if the cookie is missing/invalid/expired.
async function loadSessionUser(prisma, sessionId) {
  if (!sessionId) return null
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {})
    return null
  }
  // Slide expiry forward (rolling). Skip the write if we just slid recently
  // (within an hour) — keeps under-load DB writes manageable.
  const lastSeen = session.lastSeenAt.getTime()
  if (Date.now() - lastSeen > 60 * 60 * 1000) {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    }).catch(() => {})
  }
  return session.user
}

// --- Cookie helpers ---------------------------------------------------------
function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  }
}

function setSessionCookie(res, sessionId, expiresAt) {
  res.cookie(COOKIE_NAME, sessionId, cookieOptions(expiresAt))
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

// --- Middleware -------------------------------------------------------------
// Reads the session cookie and attaches `req.user` (or null). Always falls
// through — never throws.
function attachUser(prisma) {
  return async (req, _res, next) => {
    try {
      const sessionId = req.cookies?.[COOKIE_NAME] || null
      req.session = sessionId ? { id: sessionId } : null
      req.user = await loadSessionUser(prisma, sessionId)
    } catch (e) {
      console.error('attachUser failed', e)
      req.user = null
    }
    next()
  }
}

// Guard: rejects if no authenticated user.
function requireAuth(req, _res, next) {
  if (!req.user) return next(new UnauthorizedError('Sign in required'))
  next()
}

// Guard: rejects if user is not an admin.
function requireAdmin(req, _res, next) {
  if (!req.user) return next(new UnauthorizedError('Sign in required'))
  if (req.user.role !== 'ADMIN') return next(new ForbiddenError('Admin only'))
  next()
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  newSessionToken,
  createSession,
  destroySession,
  loadSessionUser,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  verifyGoogleIdToken,
  deriveUniqueHandle,
  isGoogleConfigured: () => !!process.env.GOOGLE_CLIENT_ID,
}
