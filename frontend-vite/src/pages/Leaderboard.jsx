import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../state/UserContext.jsx'
import { fmtChips } from '../utils'

const MODES = [
  { id: 'balance', label: 'Balance',  metric: r => fmtChips(r.balance), sub: r => `${r.gradedTrades} graded` },
  { id: 'pas',     label: 'Skill',    metric: r => `${r.pasRating}`,    sub: r => r.gradedTrades >= 5 ? `peak ${r.pasPeak}` : `${r.gradedTrades}/5 to qualify` },
  { id: 'pnl',     label: 'P&L',      metric: r => `${r.pnl >= 0 ? '+' : ''}${fmtChips(r.pnl)}`, sub: r => `${r.gradedTrades} graded`, signed: true },
  { id: 'streak',  label: 'Streak',   metric: r => `${r.streak}`,       sub: r => `best ${r.longestStreak}` },
]

// Compact rank indicator: gold/silver/bronze pill for top 3, plain "#N" beyond.
function RankBadge({ rank, size = 'sm' }) {
  const r = rank + 1
  const cls = size === 'lg' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-[11px]'
  if (rank > 2) {
    return <div className={`${cls} flex items-center justify-center font-bold text-muted tabular`}>#{r}</div>
  }
  const tones = [
    'bg-gradient-to-br from-yellow-300 to-amber-500 text-bg shadow-[0_2px_8px_rgba(251,191,36,0.35)]',
    'bg-gradient-to-br from-slate-200 to-slate-400 text-bg shadow-[0_2px_8px_rgba(148,163,184,0.35)]',
    'bg-gradient-to-br from-amber-600 to-amber-800 text-white',
  ]
  return (
    <div className={`${cls} ${tones[rank]} rounded-full flex items-center justify-center font-bold tabular`}>
      {r}
    </div>
  )
}

export default function Leaderboard() {
  const { user } = useUser()
  const [mode, setMode] = useState('balance')
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    api.leaderboard({ by: mode })
      .then(d => { if (!cancelled) setRows(d) })
      .catch(e => { console.error(e); if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [mode])

  const cfg = MODES.find(m => m.id === mode)
  const top = (rows ?? []).slice(0, 3)

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted">Where the sharpest predictors stack up. Switch metrics to see different kinds of skill.</p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-surface border border-border w-fit shadow-inner">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              mode === m.id
                ? 'bg-accent/20 text-accent shadow-[inset_0_0_0_1px_rgba(99,102,241,0.35)]'
                : 'text-muted hover:text-text hover:bg-surface2'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="skeleton h-64 rounded-2xl" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-surface/40 border border-dashed border-border p-12 text-center text-muted">
          <div className="text-sm text-text mb-1">No qualifying traders yet</div>
          {mode === 'pas' && <div className="text-xs">Skill ranks need 5+ graded trades. Be the first to break through.</div>}
        </div>
      ) : (
        <>
          {/* Podium — silver left, gold center, bronze right */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 items-end">
            {[1, 0, 2].map((rank) => {
              const r = top[rank]
              if (!r) return <div key={rank} />
              const heights = ['h-40', 'h-32', 'h-28']
              const colors = ['from-saffron to-yellow-600', 'from-slate-300 to-slate-500', 'from-amber-700 to-amber-900']
              return (
                <div key={r.user} className="flex flex-col items-center justify-end animate-pop">
                  <div className="mb-2"><RankBadge rank={rank} size="lg" /></div>
                  <div className={`w-full ${heights[rank]} rounded-t-2xl bg-gradient-to-b ${colors[rank]} flex flex-col items-center justify-end p-3 text-bg shadow-lift`}>
                    <div className="font-bold text-sm truncate max-w-full">{r.user}</div>
                    <div className="text-[12px] font-mono font-bold tabular">{cfg.metric(r)}</div>
                    <div className="text-[10px] opacity-80 truncate max-w-full">{cfg.sub(r)}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Full list */}
          <div className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-inner">
            {rows.map((r, i) => (
              <div
                key={r.user}
                className={`flex items-center gap-3 px-4 py-3 transition ${r.user === user ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-surface2/60'}`}
              >
                <div className="shrink-0"><RankBadge rank={i} /></div>
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-saffron to-accent flex items-center justify-center text-sm font-bold text-bg shrink-0">
                  {r.user[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2 truncate">
                    {r.user}
                    {r.user === user && <span className="text-[10px] text-accent font-bold uppercase tracking-wider">You</span>}
                    {r.tier === 'verified' && (
                      <ShieldCheck size={11} strokeWidth={2.25} className="text-saffron" aria-label="Verified" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted">{cfg.sub(r)}</div>
                </div>
                <div className="text-right tabular shrink-0">
                  <div className={`font-mono font-bold ${cfg.signed && r.pnl < 0 ? 'text-no' : cfg.signed && r.pnl > 0 ? 'text-yes' : ''}`}>
                    {cfg.metric(r)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
