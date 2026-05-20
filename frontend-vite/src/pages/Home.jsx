import React, { useEffect, useState } from 'react'
import { Search, X, Inbox, Sparkles, TrendingUp, Trophy, Flame, Clock } from 'lucide-react'
import { api } from '../api'
import MarketCard from '../components/MarketCard.jsx'
import { CATEGORIES, fmtChips } from '../utils'
import { useUser } from '../state/UserContext.jsx'

export default function Home() {
  const { isNewUser } = useUser()
  const [markets, setMarkets] = useState([])
  const [trending, setTrending] = useState(null)  // null = loading, [] = no data
  const [ending, setEnding] = useState(null)
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  // Dismissible client-side so a user who hides the card doesn't keep
  // seeing it within this session. Server-side `firstTradeAt` is the
  // permanent gate across devices.
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('welcomeDismissed') === '1'
  )
  const dismissWelcome = () => {
    setWelcomeDismissed(true)
    try { localStorage.setItem('welcomeDismissed', '1') } catch {}
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.listMarkets(category)
      .then(data => { if (!cancelled) setMarkets(data) })
      .catch(e => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [category])

  // Discovery carousels are category-agnostic (they show what's hot platform-
  // wide, not within the current category filter) — load once on mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.listMarkets(null, { sort: 'trending', limit: 8 }).catch(() => []),
      api.listMarkets(null, { sort: 'ending', limit: 8 }).catch(() => []),
    ]).then(([t, e]) => {
      if (cancelled) return
      setTrending(t)
      setEnding(e)
    })
    return () => { cancelled = true }
  }, [])

  const visible = markets.filter(m =>
    !search || m.description.toLowerCase().includes(search.toLowerCase())
  )
  const totalVolume = markets.reduce((sum, m) => sum + (m.volume || 0), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <section className="relative rounded-3xl bg-gradient-to-br from-saffron/20 via-surface to-green/15 border border-border/80 p-6 sm:p-8 overflow-hidden shadow-card">
        {/* Decorative blur orbs */}
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-saffron/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest text-saffron uppercase mb-3 bg-saffron/10 border border-saffron/30 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-saffron animate-pulse-soft" />
            India · Play Chips · Real Predictions
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold leading-tight tracking-tight">
            Predict cricket, politics, <span className="bg-gradient-to-r from-saffron to-accent bg-clip-text text-transparent">markets</span> &amp; more.
          </h1>
          <p className="text-sm sm:text-base text-muted mt-3 max-w-lg leading-relaxed">
            Trade virtual chips on real-world events. Climb the leaderboard. Zero real money — pure prediction skill.
          </p>
          <div className="flex items-center gap-5 mt-5 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-yes animate-pulse-soft" />
              <span className="text-text font-semibold tabular">{markets.length}</span> active
            </span>
            <span className="opacity-40">•</span>
            <span>Volume <span className="text-text font-semibold tabular">{fmtChips(totalVolume)}</span></span>
          </div>
        </div>
      </section>

      {isNewUser && !welcomeDismissed && (
        <WelcomeCard onDismiss={dismissWelcome} />
      )}

      <MarketCarousel
        title="Trending now"
        subtitle="Most-traded markets in the last 24h"
        icon={Flame}
        accent="text-orange-400"
        markets={trending}
      />

      <MarketCarousel
        title="Ending soon"
        subtitle="Markets closing in the next few days"
        icon={Clock}
        accent="text-saffron"
        markets={ending}
      />

      <div className="pt-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted mb-3">Browse all markets</h2>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search markets — IPL, Nifty, RBI…"
          className="w-full bg-surface border border-border rounded-xl pl-10 pr-10 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:border-accent/60 focus:bg-surface/80 transition shadow-inner"
        />
        <Search size={15} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1 rounded hover:bg-surface2 transition"
            aria-label="Clear search"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Category strip */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
              c === category
                ? 'bg-gradient-to-br from-accent to-indigo-500 text-white border-accent shadow-glow'
                : 'bg-surface text-muted border-border hover:border-accent/40 hover:text-text hover:bg-surface2'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton h-44 rounded-2xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl bg-surface/40 border border-dashed border-border py-16 text-center text-muted">
          <Inbox size={36} strokeWidth={1.25} className="mx-auto mb-3 text-muted/70" aria-hidden="true" />
          <div className="text-sm text-text mb-1">
            {search ? `No markets match “${search}”` : `No markets in ${category}`}
          </div>
          <div className="text-xs mb-5">
            {search ? 'Try a broader query, or clear the search.' : 'Pick a different category or create one yourself.'}
          </div>
          <div className="flex items-center justify-center gap-2">
            {search && (
              <button
                onClick={() => setSearch('')}
                className="px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-semibold hover:border-accent/40 transition"
              >
                Clear search
              </button>
            )}
            {category !== 'All' && (
              <button
                onClick={() => setCategory('All')}
                className="px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-semibold hover:border-accent/40 transition"
              >
                Show all
              </button>
            )}
          </div>
        </div>
      ) : (
        <div data-markets-grid className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m, i) => (
            <div key={m.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}>
              <MarketCard market={m} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MarketCarousel({ title, subtitle, icon: Icon, accent, markets }) {
  // null = loading skeleton; [] = no data → hide section entirely so the page
  // doesn't show an empty "Trending" rail when there's been no activity.
  if (markets !== null && markets.length === 0) return null
  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-bold inline-flex items-center gap-1.5">
            <Icon size={16} strokeWidth={2.25} className={accent} aria-hidden="true" />
            {title}
          </h2>
          <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
      {/* Horizontal-scroll carousel. Snaps on mobile, free-scrolls on desktop.
          Each card is a fixed-width slide so the row stays visually rhythmic
          regardless of market description length. */}
      <div className="-mx-1 px-1 pb-1 overflow-x-auto snap-x snap-mandatory no-scrollbar">
        <div className="flex gap-3 w-max">
          {markets === null
            ? [1, 2, 3, 4].map(i => (
                <div key={i} className="skeleton w-[280px] sm:w-[300px] h-44 rounded-2xl shrink-0" />
              ))
            : markets.map((m, i) => (
                <div
                  key={m.id}
                  className="w-[280px] sm:w-[300px] shrink-0 snap-start animate-slide-up"
                  style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
                >
                  <MarketCard market={m} />
                </div>
              ))}
        </div>
      </div>
    </section>
  )
}

function WelcomeCard({ onDismiss }) {
  const steps = [
    { icon: TrendingUp, title: 'Pick a side', body: 'Each market has 2–6 outcomes. The price is the crowd’s probability.' },
    { icon: Sparkles, title: 'Spend chips', body: 'Buy shares of the outcome you think is right. Cheaper price = bigger payout.' },
    { icon: Trophy, title: 'Get paid', body: 'When the event resolves, every winning share pays 1 chip. Claim and climb.' },
  ]
  const scrollToMarkets = () => {
    document.querySelector('[data-markets-grid]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <section className="relative rounded-2xl bg-gradient-to-br from-accent/15 via-surface to-saffron/10 border border-accent/30 p-5 sm:p-6 animate-slide-up">
      <button
        onClick={onDismiss}
        aria-label="Dismiss welcome"
        className="absolute top-3 right-3 text-muted hover:text-text p-1.5 rounded-lg hover:bg-surface2 transition"
      >
        <X size={14} strokeWidth={2} />
      </button>
      <div className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-accent uppercase mb-2 bg-accent/15 border border-accent/30 rounded-full px-2.5 py-0.5">
        <Sparkles size={10} strokeWidth={2.5} aria-hidden="true" />
        Welcome
      </div>
      <h2 className="text-lg sm:text-xl font-bold leading-snug">Place your first prediction.</h2>
      <p className="text-xs sm:text-sm text-muted mt-1 max-w-xl">
        You start with 5000 chips. No real money, ever. Spend them on what you think will happen, and earn more when you’re right.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl bg-surface/70 border border-border/80 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-md bg-accent/20 text-accent inline-flex items-center justify-center">
                <s.icon size={13} strokeWidth={2.25} aria-hidden="true" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Step {i + 1}</span>
            </div>
            <div className="text-sm font-semibold leading-tight">{s.title}</div>
            <div className="text-[11px] text-muted mt-1 leading-snug">{s.body}</div>
          </div>
        ))}
      </div>
      <button
        onClick={scrollToMarkets}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-accent to-indigo-500 text-white text-xs font-bold hover:shadow-glow transition"
      >
        Browse markets
        <TrendingUp size={12} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </section>
  )
}
