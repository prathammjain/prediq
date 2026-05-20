import React, { useMemo } from 'react'

// Renders one line per outcome, stacked into the same SVG viewport.
// `history` is an array of { t, percents: number[] }.
export default function Sparkline({ history, outcomes, width = 600, height = 160 }) {
  const series = useMemo(() => {
    if (!history || history.length === 0) {
      return outcomes.map(() => [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])
    }
    const minT = history[0].t
    const maxT = history[history.length - 1].t
    const span = maxT - minT || 1
    return outcomes.map((_, idx) =>
      history.map(h => ({
        x: span ? (h.t - minT) / span : 0,
        y: 1 - (h.percents?.[idx] ?? 0),
      }))
    )
  }, [history, outcomes])

  const colors = ['#22c55e', '#ef4444', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899']

  const toPath = (pts) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * width} ${p.y * height}`)
      .join(' ')

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-40">
        {/* horizontal grid */}
        {[0.25, 0.5, 0.75].map(g => (
          <line key={g} x1="0" x2={width} y1={g * height} y2={g * height} stroke="#222b40" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        {series.map((pts, idx) => (
          <path
            key={idx}
            d={toPath(pts)}
            fill="none"
            stroke={colors[idx % colors.length]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
        {outcomes.map((o, idx) => (
          <div key={o} className="flex items-center gap-1.5 text-muted">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colors[idx % colors.length] }} />
            {o}
          </div>
        ))}
      </div>
    </div>
  )
}
