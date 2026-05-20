import React, { useEffect, useState } from 'react'
import { api } from '../api'
import ReliabilityDiagram from './ReliabilityDiagram.jsx'

// User stats: PAS rating + scoring summary tiles + reliability diagram.
// Loads scoring + calibration in parallel and renders both regardless of
// whether either has data yet (the diagram component handles N=0 itself).
export default function StatsPanel({ user }) {
  const [scoring, setScoring] = useState(null)
  const [cal, setCal] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([api.scoring(user), api.calibration(user, 10)])
      .then(([s, c]) => {
        if (cancelled) return
        setScoring(s)
        setCal(c)
      })
      .catch(e => console.error('stats load failed', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user])

  if (loading) return <div className="skeleton h-64 rounded-2xl" />
  if (!scoring) return null

  const tiles = [
    {
      label: 'PAS rating',
      value: scoring.pasRating?.toFixed(0) ?? '—',
      sub: scoring.pasPeak ? `peak ${Math.round(scoring.pasPeak)}` : null,
      accent: true,
    },
    {
      label: 'Accuracy',
      value: scoring.accuracy != null ? `${(scoring.accuracy * 100).toFixed(0)}%` : '—',
      sub: `${scoring.gradedTrades} graded`,
    },
    {
      label: 'Brier loss',
      value: scoring.meanBrier != null ? scoring.meanBrier.toFixed(3) : '—',
      sub: 'lower = better',
    },
    {
      label: 'Log loss',
      value: scoring.meanLogLoss != null ? scoring.meanLogLoss.toFixed(3) : '—',
      sub: 'lower = better',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div
            key={t.label}
            className={`rounded-xl border p-3 ${
              t.accent ? 'bg-accent/10 border-accent/30' : 'bg-surface border-border'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted">{t.label}</div>
            <div className={`text-lg font-bold mt-0.5 font-mono ${t.accent ? 'text-accent' : 'text-text'}`}>
              {t.value}
            </div>
            {t.sub && <div className="text-[10px] text-muted mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>

      <ReliabilityDiagram
        bins={cal?.bins ?? []}
        ece={cal?.ece ?? 0}
        mce={cal?.mce ?? 0}
        total={cal?.total ?? 0}
      />

      {cal && cal.total > 0 && (
        <div className="grid grid-cols-3 gap-3 text-[11px] font-mono">
          <Decomp label="Reliability" value={cal.reliability} hint="lower = closer to diagonal" />
          <Decomp label="Resolution" value={cal.resolution} hint="higher = sharper predictions" />
          <Decomp label="Uncertainty" value={cal.uncertainty} hint="base-rate variance" />
        </div>
      )}
    </div>
  )
}

const Decomp = ({ label, value, hint }) => (
  <div className="rounded-xl bg-surface border border-border p-3">
    <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    <div className="text-sm font-bold mt-0.5">{value != null ? value.toFixed(3) : '—'}</div>
    <div className="text-[10px] text-muted mt-0.5">{hint}</div>
  </div>
)
