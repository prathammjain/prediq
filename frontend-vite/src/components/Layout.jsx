import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import {
  Home as IconHome, BarChart3, Trophy, Plus, FileText, LogOut, ShieldCheck,
  ChevronDown,
} from 'lucide-react'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { fmtChips } from '../utils'

const TopNavLink = ({ to, label, badge }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className={({ isActive }) =>
      `relative px-3 py-2 rounded-lg text-sm font-medium transition ${
        isActive ? 'bg-surface2 text-text' : 'text-muted hover:text-text hover:bg-surface'
      }`
    }
  >
    {label}
    {badge > 0 && <NavBadge count={badge} />}
  </NavLink>
)

const BottomNavLink = ({ to, label, Icon, badge }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className={({ isActive }) =>
      `relative flex flex-col items-center justify-center gap-1 flex-1 py-2.5 min-h-[56px] active:bg-surface2 transition ${
        isActive ? 'text-accent' : 'text-muted'
      }`
    }
  >
    <div className="relative">
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      {badge > 0 && <NavBadge count={badge} compact />}
    </div>
    <span className="text-[10px] font-medium">{label}</span>
  </NavLink>
)

// Pill badge for nav links. Renders inline on desktop (top nav) and
// absolute-positioned over the icon on mobile (bottom nav).
function NavBadge({ count, compact }) {
  const cls = compact
    ? 'absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 text-[9px] rounded-full bg-saffron text-bg font-bold inline-flex items-center justify-center shadow-glow ring-2 ring-bg'
    : 'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] rounded-full bg-saffron text-bg font-bold align-middle'
  return <span className={cls}>{count > 9 ? '9+' : count}</span>
}

// Avatar + dropdown for the signed-in user. When signed out, renders a
// pair of Sign in / Sign up CTAs instead.
function AccountMenu() {
  const { me, signOut, loading } = useUser()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const rootRef = useRef(null)

  // Close on outside-click and Escape. Using a document listener instead
  // of a transparent overlay div avoids stacking-context surprises (the
  // overlay was racing with the trigger button's toggle).
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (loading) {
    return <div className="w-9 h-9 rounded-full bg-surface2 animate-pulse-soft" />
  }

  if (!me) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          to="/login"
          className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-sm font-medium text-text hover:text-accent transition"
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-accent to-indigo-500 text-white text-xs sm:text-sm font-bold shadow-glow hover:-translate-y-px transition"
        >
          Sign up
        </Link>
      </div>
    )
  }

  const handleLogout = async () => {
    setOpen(false)
    await signOut()
    nav('/', { replace: true })
    toast.info('Signed out.')
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-1.5 py-1 sm:pl-1.5 sm:pr-2.5 rounded-full bg-surface border border-border hover:border-accent/50 transition shadow-inner"
      >
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-saffron to-accent flex items-center justify-center text-sm font-bold text-bg shadow-inner">
          {me.handle[0].toUpperCase()}
        </span>
        <span className="hidden sm:block text-sm font-semibold tracking-tight">{me.handle}</span>
        <ChevronDown size={14} strokeWidth={2} className="hidden sm:block text-muted" aria-hidden="true" />
      </button>
      {open && (
          <div className="absolute right-0 mt-2 w-60 rounded-xl bg-surface border border-border shadow-lift z-20 overflow-hidden animate-slide-up">
            <div className="px-4 py-3 border-b border-border bg-gradient-to-br from-surface to-surface2/50">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-saffron to-accent flex items-center justify-center text-sm font-bold text-bg">
                  {me.handle[0].toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate">{me.handle}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted">
                    {me.role === 'ADMIN' ? (
                      <span className="inline-flex items-center gap-1 text-saffron font-semibold">
                        <ShieldCheck size={10} strokeWidth={2.25} aria-hidden="true" />
                        Admin
                      </span>
                    ) : (
                      <span>Member</span>
                    )}
                    <span className="opacity-40">•</span>
                    <span className="tabular">PAS {me.pasRating}</span>
                  </div>
                </div>
              </div>
            </div>
            <MenuItem to="/portfolio" onClick={() => setOpen(false)} Icon={BarChart3} label="Portfolio" />
            <MenuItem to="/leaderboard" onClick={() => setOpen(false)} Icon={Trophy} label="Leaderboard" />
            {me.role === 'ADMIN' && (
              <MenuItem to="/admin/drafts" onClick={() => setOpen(false)} Icon={FileText} label="Draft queue" />
            )}
            <div className="border-t border-border" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface2/80 transition text-no"
            >
              <LogOut size={15} strokeWidth={2} aria-hidden="true" />
              <span className="font-medium">Sign out</span>
            </button>
          </div>
      )}
    </div>
  )
}

const MenuItem = ({ to, Icon, label, onClick }) => (
  <Link
    to={to}
    onClick={onClick}
    className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface2/80 transition text-text"
  >
    <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
    <span className="font-medium">{label}</span>
  </Link>
)

// Format a future-time as a compact countdown ("4h 32m", "12m", "47s").
function fmtCountdown(ms) {
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mr = m % 60
  return mr === 0 ? `${h}h` : `${h}h ${mr}m`
}

// Tick every second so the countdown stays live without re-rendering the
// whole page. Returns Date.now() each tick.
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function BalanceChip() {
  const { balance, claimBonus, nextBonusAt } = useUser()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const now = useNow(1000)

  const ready = !nextBonusAt || nextBonusAt <= now
  const remaining = nextBonusAt ? nextBonusAt - now : 0

  const onBonus = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const r = await claimBonus()
      if (r.credited > 0) {
        toast.success({ title: 'Daily bonus claimed', body: `+${fmtChips(r.credited)} added to your balance.` })
      } else {
        toast.info(`Already claimed — back in ${fmtCountdown(r.nextEligibleAt - Date.now())}`)
      }
    } catch (e) {
      toast.error(e?.message ?? 'Could not claim bonus.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-gradient-to-r from-saffron/15 to-green/15 border border-saffron/30 shadow-inner sheen">
        <div className="hidden sm:block text-[9px] uppercase tracking-widest text-muted leading-none font-semibold">Chips</div>
        <div className="text-sm font-bold text-text leading-tight whitespace-nowrap tabular flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-saffron" aria-hidden="true" />
          {Math.round(balance).toLocaleString('en-IN')}
        </div>
      </div>
      <button
        onClick={onBonus}
        disabled={!ready || busy}
        title={ready ? 'Claim daily bonus' : `Next bonus in ${fmtCountdown(remaining)}`}
        className={`relative px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
          ready
            ? 'bg-gradient-to-br from-accent to-indigo-500 text-white border border-accent/60 shadow-glow hover:shadow-lift hover:-translate-y-px animate-pulse-soft'
            : 'bg-surface border border-border text-muted cursor-not-allowed'
        }`}
      >
        {ready ? '+500' : <span className="tabular">{fmtCountdown(remaining)}</span>}
      </button>
    </div>
  )
}

export default function Layout({ children }) {
  const { me, actions } = useUser()
  const isAdmin = me?.role === 'ADMIN'
  const signedIn = !!me
  const actionCount = actions?.total ?? 0
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-saffron to-green flex items-center justify-center font-bold text-bg text-sm shrink-0">P</div>
            <div className="font-bold text-sm sm:text-lg tracking-tight truncate">pred<span className="text-accent">IQ</span></div>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <TopNavLink to="/" label="Markets" />
            <TopNavLink to="/portfolio" label="Portfolio" badge={signedIn ? actionCount : 0} />
            <TopNavLink to="/leaderboard" label="Leaderboard" />
            <TopNavLink to="/create" label="Create" />
            {isAdmin && <TopNavLink to="/admin/drafts" label="Drafts" />}
          </nav>
          <div className="flex items-center gap-2">
            {signedIn && <BalanceChip />}
            <AccountMenu />
          </div>
        </div>
      </header>

      {/* Page */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-8">
        {children}
      </main>

      {/* Bottom nav (mobile) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-border flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <BottomNavLink to="/" label="Home" Icon={IconHome} />
        <BottomNavLink to="/portfolio" label="Portfolio" Icon={BarChart3} badge={signedIn ? actionCount : 0} />
        <BottomNavLink to="/create" label="Create" Icon={Plus} />
        <BottomNavLink to="/leaderboard" label="Top" Icon={Trophy} />
      </nav>

      {/* Footer disclaimer */}
      <footer className="hidden md:block border-t border-border py-4 text-center text-xs text-muted">
        predIQ uses <span className="text-text font-medium">virtual play chips only</span>. No real money, no crypto, no cashout, no deposits. Just prediction skill. For entertainment &amp; education.
      </footer>
    </div>
  )
}
