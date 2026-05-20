// All amounts are virtual play chips — no real currency of any kind.
export const fmtChips = (n) => {
  const v = Math.round(Number(n) || 0)
  return v.toLocaleString('en-IN') + ' chips'
}

// Compact form ("1.2k") for dense UI
export const fmtChipsShort = (n) => {
  const v = Math.round(Number(n) || 0)
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
  return String(v)
}

export const fmtPct = (p) => `${(p * 100).toFixed(0)}%`

export const fmtRelative = (ts) => {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const day = 24 * 60 * 60 * 1000
  const hour = 60 * 60 * 1000
  const min = 60 * 1000
  const sign = diff < 0 ? 'ago' : 'left'
  if (abs > day) return `${Math.floor(abs / day)}d ${sign}`
  if (abs > hour) return `${Math.floor(abs / hour)}h ${sign}`
  if (abs > min) return `${Math.floor(abs / min)}m ${sign}`
  return `<1m ${sign}`
}

export const categoryColor = (cat) => {
  const map = {
    Cricket: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    Football: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
    Politics: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    Economy: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    Markets: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    Entertainment: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    Science: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    Geopolitics: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    Other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  }
  return map[cat] || map.Other
}

export const CATEGORIES = ['All', 'Cricket', 'Football', 'Politics', 'Economy', 'Markets', 'Entertainment', 'Science', 'Geopolitics', 'Other']
