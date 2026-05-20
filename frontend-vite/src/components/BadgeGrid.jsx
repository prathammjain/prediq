import React, { useEffect, useState } from 'react'
import { Zap, Flame, Target, Crown, Waves, Scale, ArrowDownUp, Award, Lock } from 'lucide-react'
import { api } from '../api'

// BadgeGrid — trophy case for a user.
// Earned badges glow; locked ones are dimmed with a hint about how to unlock.
//
// Backend response: { earned: [...], available: [...] }
//   earned   — { slug, name, description, iconName, earnedAt }
//   available — { slug, name, description, conditionType, threshold, iconName }

const ICONS = {
  spark: Zap,
  flame: Flame,
  'flame-double': Flame,    // same glyph; rendered larger via the size prop
  target: Target,
  crown: Crown,
  wave: Waves,
  scale: Scale,
  'arrow-down-up': ArrowDownUp,
}

function iconFor(slug) {
  return ICONS[slug] ?? Award
}

function unlockHint(b) {
  switch (b.conditionType) {
    case 'STREAK': return `Win ${b.threshold} in a row`
    case 'PAS': return `Reach a ${b.threshold} PAS rating`
    case 'VOLUME': return `Stake ${b.threshold.toLocaleString('en-IN')} chips`
    case 'CALIBRATION': return `ECE ≤ ${b.threshold} over 50+ trades`
    case 'ACCURACY': return `${(b.threshold * 100).toFixed(0)}% accuracy`
    default: return b.description
  }
}

export default function BadgeGrid({ user }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.badges(user)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => console.error('badges fetch failed', e))
    return () => { cancelled = true }
  }, [user])

  if (!data) return <div className="skeleton h-40 rounded-2xl" />

  const total = data.earned.length + data.available.length
  return (
    <div className="rounded-2xl bg-surface border border-border shadow-inner p-5 animate-slide-up">
      <div className="flex items-baseline justify-between mb-4 gap-3">
        <div>
          <div className="text-sm font-semibold">Badges</div>
          <div className="text-[11px] text-muted mt-0.5">
            Achievements unlock as your prediction record grows.
          </div>
        </div>
        <div className="text-[11px] text-muted tabular">
          <span className="text-text font-semibold">{data.earned.length}</span> / {total}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {data.earned.map(b => (
          <BadgeTile key={b.slug} badge={b} earned />
        ))}
        {data.available.map(b => (
          <BadgeTile key={b.slug} badge={b} earned={false} />
        ))}
      </div>
    </div>
  )
}

const BadgeTile = ({ badge, earned }) => {
  const Icon = iconFor(badge.iconName)
  return (
    <div
      className={`group relative rounded-xl border p-3 transition ${
        earned
          ? 'bg-gradient-to-br from-saffron/15 to-accent/10 border-saffron/40 shadow-[0_0_0_1px_rgba(255,153,51,0.18),0_8px_24px_rgba(255,153,51,0.10)]'
          : 'bg-surface2/60 border-border opacity-60 hover:opacity-90 hover:border-accent/30'
      }`}
      title={earned ? badge.description : unlockHint(badge)}
    >
      <div
        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-2 ${
          earned ? 'bg-saffron/15 text-saffron' : 'bg-surface2 text-muted'
        }`}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className={`text-xs font-semibold leading-tight ${earned ? 'text-text' : 'text-muted'}`}>
        {badge.name}
      </div>
      <div className="text-[10px] text-muted mt-1 leading-snug line-clamp-2">
        {earned ? badge.description : unlockHint(badge)}
      </div>
      {!earned && (
        <div className="absolute top-2.5 right-2.5 text-muted/70" aria-hidden="true">
          <Lock size={11} strokeWidth={2} />
        </div>
      )}
    </div>
  )
}
