import React from 'react'
import { Link } from 'react-router-dom'
import { fmtChips, fmtPct, fmtRelative, categoryColor } from '../utils'

export default function MarketCard({ market }) {
  const isBinary = market.outcomes.length === 2
  const outcomesWithIdx = market.outcomes.map((name, i) => ({
    name, pct: market.percents[i], idx: i,
  }))
  // Keep original order for binary (Yes/No stays fixed); sort leader-first for multi-outcome.
  const displayed = isBinary ? outcomesWithIdx : [...outcomesWithIdx].sort((a, b) => b.pct - a.pct)
  const top = [...outcomesWithIdx].sort((a, b) => b.pct - a.pct)[0]

  const statusPill = market.status === 'RESOLVED'
    ? { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: 'RESOLVED' }
    : market.status === 'DISPUTED'
      ? { cls: 'bg-no/15 text-no border-no/40', label: 'DISPUTED' }
      : market.status === 'PROPOSED'
        ? { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'PROPOSED' }
        : null

  return (
    <Link
      to={`/market/${market.id}`}
      className="group block rounded-2xl bg-surface border border-border active:scale-[0.99] shadow-card overflow-hidden card-lift"
    >
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${categoryColor(market.category)}`}>
                {market.category}
              </span>
              {statusPill && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusPill.cls}`}>
                  {statusPill.label}
                </span>
              )}
            </div>
            <h3 className="text-[15px] font-semibold leading-snug line-clamp-2 group-hover:text-accent transition">
              {market.description}
            </h3>
          </div>
          {isBinary && (
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold text-text leading-none tabular">{fmtPct(top.pct)}</div>
              <div className="text-[10px] text-muted uppercase mt-1 tracking-wider font-semibold">{top.name}</div>
            </div>
          )}
        </div>

        {/* Outcome bars */}
        <div className="flex flex-col gap-1.5">
          {displayed.slice(0, isBinary ? 2 : 3).map((o, rank) => (
            <div key={o.idx} className="flex items-center gap-2 text-xs">
              <span className="w-20 truncate text-muted">{o.name}</span>
              <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(o.pct * 100, 2)}%`,
                    background: isBinary
                      ? (o.idx === 0
                          ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                          : 'linear-gradient(90deg, #ef4444, #dc2626)')
                      : (rank === 0
                          ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                          : 'linear-gradient(90deg, #6366f1, #4f46e5)'),
                  }}
                />
              </div>
              <span className="w-10 text-right font-mono text-text font-medium tabular">{fmtPct(o.pct)}</span>
            </div>
          ))}
          {displayed.length > 3 && !isBinary && (
            <div className="text-[11px] text-muted">+{displayed.length - 3} more outcomes</div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-2 border-t border-border text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="opacity-60">Vol</span>
            <span className="text-text font-semibold tabular">{fmtChips(market.volume)}</span>
          </span>
          <span className="tabular">{fmtRelative(market.endTime)}</span>
        </div>
      </div>
    </Link>
  )
}
