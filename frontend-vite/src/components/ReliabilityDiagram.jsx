import React from 'react'

// Reliability (calibration) diagram. Each non-empty bin becomes a marker at
// (meanPredicted, empiricalFreq); marker radius scales with sqrt(count) so
// a few large samples don't drown out the rest. Perfect calibration is the
// y = x diagonal — points above the diagonal are under-confident, points
// below are over-confident.
//
// Props:
//   bins   — calibration bins from /api/users/:user/calibration
//   ece    — Expected Calibration Error  (0..1)
//   mce    — Maximum Calibration Error   (0..1)
//   total  — total graded trades
//
// Uses no chart library — pure SVG so the component stays small and prints
// to the same theme tokens as the rest of the app.
export default function ReliabilityDiagram({ bins = [], ece = 0, mce = 0, total = 0 }) {
  const W = 320, H = 320, PAD = 36
  const innerW = W - 2 * PAD, innerH = H - 2 * PAD
  const x = (p) => PAD + p * innerW
  const y = (p) => PAD + (1 - p) * innerH

  const filled = bins.filter(b => b.count > 0 && b.meanPredicted != null)
  const maxCount = Math.max(1, ...filled.map(b => b.count))

  if (total < 1) {
    return (
      <div className="rounded-2xl bg-surface border border-border p-5">
        <div className="text-sm font-semibold mb-1">Calibration</div>
        <div className="text-xs text-muted">
          You haven&rsquo;t had a graded trade yet. Buy shares in a market — once it
          resolves your trades will be scored and a reliability curve will appear here.
        </div>
      </div>
    )
  }

  const gridTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="rounded-2xl bg-surface border border-border p-5">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">Calibration</div>
          <div className="text-[11px] text-muted">
            How well your stated probabilities match reality. Closer to the diagonal = better calibrated.
          </div>
        </div>
        <div className="flex gap-3 text-[11px] font-mono">
          <span><span className="text-muted">ECE</span> {(ece * 100).toFixed(1)}%</span>
          <span><span className="text-muted">MCE</span> {(mce * 100).toFixed(1)}%</span>
          <span><span className="text-muted">N</span> {total}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-w-[420px] mx-auto block"
      >
        {/* Plot area background */}
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="rgba(255,255,255,0.02)" />

        {/* Grid */}
        {gridTicks.map(t => (
          <g key={`gx-${t}`} stroke="rgba(255,255,255,0.06)">
            <line x1={x(t)} y1={PAD} x2={x(t)} y2={PAD + innerH} />
            <line x1={PAD} y1={y(t)} x2={PAD + innerW} y2={y(t)} />
          </g>
        ))}

        {/* Perfect-calibration diagonal */}
        <line
          x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
          stroke="rgba(255,255,255,0.35)" strokeDasharray="4 4" strokeWidth="1"
        />

        {/* Calibration curve through bins */}
        {filled.length > 1 && (
          <polyline
            points={filled.map(b => `${x(b.meanPredicted)},${y(b.empiricalFreq)}`).join(' ')}
            fill="none" stroke="#6366f1" strokeWidth="1.5" opacity="0.7"
          />
        )}

        {/* Bin markers */}
        {filled.map(b => {
          const r = 3 + 9 * Math.sqrt(b.count / maxCount)
          // Tint by error: closer to diagonal = green, far = red
          const err = Math.abs(b.empiricalFreq - b.meanPredicted)
          const fill = err < 0.05 ? '#22c55e' : err < 0.15 ? '#facc15' : '#ef4444'
          return (
            <circle
              key={b.bin}
              cx={x(b.meanPredicted)}
              cy={y(b.empiricalFreq)}
              r={r}
              fill={fill} fillOpacity="0.85"
              stroke="rgba(0,0,0,0.4)" strokeWidth="0.5"
            >
              <title>
                {`Predicted ${(b.meanPredicted * 100).toFixed(1)}% · Actual ${(b.empiricalFreq * 100).toFixed(1)}% · n=${b.count}`}
              </title>
            </circle>
          )
        })}

        {/* Axes ticks */}
        {gridTicks.map(t => (
          <g key={`tx-${t}`} fill="rgba(255,255,255,0.55)" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, monospace">
            <text x={x(t)} y={PAD + innerH + 14} textAnchor="middle">{Math.round(t * 100)}%</text>
            <text x={PAD - 6} y={y(t) + 3} textAnchor="end">{Math.round(t * 100)}%</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={PAD + innerW / 2} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">
          Stated probability
        </text>
        <text
          x={10} y={PAD + innerH / 2}
          transform={`rotate(-90 10 ${PAD + innerH / 2})`}
          textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11"
        >
          Empirical frequency
        </text>
      </svg>
    </div>
  )
}
