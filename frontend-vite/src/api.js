// All requests include the session cookie (`credentials: 'include'`),
// throw a structured error for non-2xx responses, and parse JSON.
//
// Error shape from the server: { error, code, details? }. The throw
// preserves `code` and `details` on the Error instance so UI code can
// branch on them (e.g. show a login modal on UNAUTHORIZED).

class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function parse(res) {
  // Try JSON first; fall back to text for unexpected non-JSON responses.
  let data = null
  try { data = await res.json() } catch (_) { /* empty / non-JSON */ }
  if (!res.ok) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, {
      status: res.status,
      code: data?.code,
      details: data?.details,
    })
  }
  return data
}

const baseInit = { credentials: 'include' }

const get = (url) => fetch(url, baseInit).then(parse)

const send = (method, url, body) =>
  fetch(url, {
    ...baseInit,
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(parse)

const postJSON = (url, body) => send('POST', url, body)

export const api = {
  // --- Auth ----------------------------------------------------------------
  register: (handle, password, email) => postJSON('/api/auth/register', { handle, password, email }),
  login: (handle, password) => postJSON('/api/auth/login', { handle, password }),
  logout: () => postJSON('/api/auth/logout'),
  me: () => get('/api/auth/me'),
  actions: () => get('/api/me/actions'),
  claimAll: () => postJSON('/api/me/claim-all'),
  authProviders: () => get('/api/auth/providers'),
  googleSignIn: (idToken) => postJSON('/api/auth/google', { idToken }),

  // --- Markets -------------------------------------------------------------
  listMarkets: (category, { sort, limit } = {}) => {
    const qs = new URLSearchParams()
    if (category && category !== 'All') qs.set('category', category)
    if (sort) qs.set('sort', sort)
    if (limit) qs.set('limit', String(limit))
    const s = qs.toString()
    return get(`/api/markets${s ? `?${s}` : ''}`)
  },
  getMarket: (id) => get(`/api/markets/${id}`),
  createMarket: (body) => postJSON('/api/markets', body),

  trade: (id, { outcome, chips }) => postJSON(`/api/markets/${id}/trade`, { outcome, chips }),
  preview: (id, { outcome, chips }) => postJSON(`/api/markets/${id}/preview`, { outcome, chips }),
  sell: (id, { outcome, shares }) => postJSON(`/api/markets/${id}/sell`, { outcome, shares }),
  sellPreview: (id, { outcome, shares }) => postJSON(`/api/markets/${id}/sell-preview`, { outcome, shares }),

  // Resolution lifecycle — server reads user from session cookie.
  propose: (id, outcome) => postJSON(`/api/markets/${id}/propose`, { outcome }),
  dispute: (id) => postJSON(`/api/markets/${id}/dispute`),
  finalize: (id, outcome) => postJSON(`/api/markets/${id}/finalize`, { outcome }),
  claim: (id) => postJSON(`/api/markets/${id}/claim`),

  // --- Self ----------------------------------------------------------------
  balance: () => get('/api/me/balance'),
  bonus: () => postJSON('/api/me/bonus'),
  positions: () => get('/api/me/positions'),
  transactions: (limit = 50) => get(`/api/me/transactions?limit=${limit}`),

  // --- Public profiles -----------------------------------------------------
  scoring: (user) => get(`/api/users/${encodeURIComponent(user)}/scoring`),
  calibration: (user, bins = 10) => get(`/api/users/${encodeURIComponent(user)}/calibration?bins=${bins}`),
  badges: (user) => get(`/api/users/${encodeURIComponent(user)}/badges`),

  // --- Leaderboard ---------------------------------------------------------
  leaderboard: ({ by = 'balance', limit = 50 } = {}) =>
    get(`/api/leaderboard?by=${encodeURIComponent(by)}&limit=${limit}`),

  // --- Admin: news → drafts pipeline (requires role=ADMIN) ----------------
  admin: {
    ingest: () => postJSON('/api/admin/news/ingest'),
    listDrafts: (status = 'PENDING', { cursor, take = 25 } = {}) => {
      const qs = new URLSearchParams({ status, take: String(take) })
      if (cursor) qs.set('cursor', String(cursor))
      return get(`/api/admin/drafts?${qs}`)
    },
    approveDraft: (id, overrides) => postJSON(`/api/admin/drafts/${id}/approve`, overrides ?? {}),
    rejectDraft: (id) => postJSON(`/api/admin/drafts/${id}/reject`),
    bulkReject: (ids) => postJSON('/api/admin/drafts/bulk-reject', { ids }),
  },
}

export { ApiError }
