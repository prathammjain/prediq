import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useUser } from '../state/UserContext.jsx'
import GoogleSignInButton from '../components/GoogleSignInButton.jsx'

// Login page. Reads `?next=<path>` so we can redirect the user back to
// wherever they were trying to go. Falls back to /portfolio.
//
// Errors come through verbatim from the server (typed via ApiError), so
// "Invalid credentials" / "Handle taken" surface naturally.

export default function Login() {
  const { signIn, me, loading } = useUser()
  const nav = useNavigate()
  const { search } = useLocation()
  const next = new URLSearchParams(search).get('next') || '/portfolio'
  const handleRef = useRef(null)

  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // If the session is already valid, bounce out immediately.
  useEffect(() => {
    if (!loading && me) nav(next, { replace: true })
  }, [loading, me, nav, next])

  // Auto-focus the handle field on mount.
  useEffect(() => { handleRef.current?.focus() }, [])

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await signIn(handle.trim(), password)
      nav(next, { replace: true })
    } catch (e) {
      setErr(e?.message ?? 'Sign in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-sm">
        {/* Decorative header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-saffron to-accent shadow-glow mb-3">
            <span className="text-bg font-bold text-lg">P</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted mt-1">Sign in to keep predicting.</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl bg-surface border border-border shadow-card p-5 space-y-4 animate-slide-up"
        >
          <Field label="Handle">
            <input
              ref={handleRef}
              value={handle}
              onChange={e => setHandle(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              placeholder="alice"
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 transition"
            />
          </Field>

          <Field label="Password">
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 pr-12 text-sm focus:outline-none focus:border-accent/60 transition"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] text-muted hover:text-text rounded"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          {err && (
            <div className="rounded-lg bg-no/10 border border-no/40 px-3 py-2 text-xs text-no animate-pop">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !handle || !password}
            className="w-full py-2.5 rounded-lg bg-gradient-to-br from-accent to-indigo-500 text-white font-bold text-sm shadow-glow hover:-translate-y-px transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <GoogleSignInButton onSignedIn={() => nav(next, { replace: true })} />

          <div className="text-center text-xs text-muted pt-1">
            New here?{' '}
            <Link
              to={`/signup${search ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="text-accent font-semibold hover:underline"
            >
              Create an account
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-[11px] uppercase tracking-wider text-muted mb-1.5 font-semibold">{label}</div>
    {children}
  </label>
)

