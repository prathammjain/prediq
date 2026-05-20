import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useUser } from '../state/UserContext.jsx'
import GoogleSignInButton from '../components/GoogleSignInButton.jsx'

// Signup page. Email is optional. Password must be ≥ 8 characters
// (server enforces; we validate client-side as a UX nicety).

const MIN_PASSWORD = 8

export default function Signup() {
  const { signUp, me, loading } = useUser()
  const nav = useNavigate()
  const { search } = useLocation()
  const next = new URLSearchParams(search).get('next') || '/portfolio'
  const handleRef = useRef(null)

  const [handle, setHandle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!loading && me) nav(next, { replace: true })
  }, [loading, me, nav, next])

  useEffect(() => { handleRef.current?.focus() }, [])

  const handleValid = /^[A-Za-z0-9_]{3,20}$/.test(handle.trim())
  const passwordValid = password.length >= MIN_PASSWORD
  const canSubmit = handleValid && passwordValid && !busy

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!canSubmit) return
    setBusy(true)
    try {
      await signUp(handle.trim(), password, email.trim() || undefined)
      nav(next, { replace: true })
    } catch (e) {
      setErr(e?.message ?? 'Sign up failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-saffron to-accent shadow-glow mb-3">
            <span className="text-bg font-bold text-lg">P</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted mt-1">5,000 chips on the house. No real money — pure prediction skill.</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl bg-surface border border-border shadow-card p-5 space-y-4 animate-slide-up"
        >
          <Field label="Handle" hint="Letters, numbers, underscores. 3–20 chars.">
            <input
              ref={handleRef}
              value={handle}
              onChange={e => setHandle(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              placeholder="alice"
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 transition"
            />
            {handle && !handleValid && (
              <div className="text-[11px] text-no mt-1">3–20 letters/numbers/underscores only</div>
            )}
          </Field>

          <Field label="Email" hint="Optional. We'll only use it for account recovery.">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="alice@example.com"
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 transition"
            />
          </Field>

          <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
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
            {/* Strength indicator */}
            <div className="mt-1.5 h-1 rounded-full bg-surface2 overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (password.length / 16) * 100)}%`,
                  background: password.length >= 12 ? '#22c55e' : password.length >= MIN_PASSWORD ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
          </Field>

          {err && (
            <div className="rounded-lg bg-no/10 border border-no/40 px-3 py-2 text-xs text-no animate-pop">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-2.5 rounded-lg bg-gradient-to-br from-accent to-indigo-500 text-white font-bold text-sm shadow-glow hover:-translate-y-px transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>

          <GoogleSignInButton onSignedIn={() => nav(next, { replace: true })} />

          <div className="text-center text-xs text-muted pt-1">
            Already have an account?{' '}
            <Link
              to={`/login${search ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="text-accent font-semibold hover:underline"
            >
              Sign in
            </Link>
          </div>
        </form>

        <p className="text-[11px] text-muted text-center mt-4 leading-relaxed">
          By creating an account you agree that predIQ uses virtual play chips only. No real money, no cashout, no deposits.
        </p>
      </div>
    </div>
  )
}

const Field = ({ label, hint, children }) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1.5">
      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      {hint && <div className="text-[10px] text-muted/80">{hint}</div>}
    </div>
    {children}
  </label>
)

