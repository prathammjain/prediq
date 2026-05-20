import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gift, Sun, TrendingUp, Trophy, Settings, Receipt, Circle } from 'lucide-react'
import { api } from '../api'
import { fmtChips } from '../utils'

// Append-only chip ledger from /api/me/transactions.
// Coloured by direction (credits = yes-green, debits = no-red), grouped by
// type with a friendly icon. Market-linked rows deep-link to the market.

const TYPE_META = {
  SIGNUP_BONUS:  { Icon: Gift,        label: 'Signup bonus' },
  DAILY_BONUS:   { Icon: Sun,         label: 'Daily bonus' },
  TRADE_BUY:     { Icon: TrendingUp,  label: 'Trade — buy' },
  TRADE_PAYOUT:  { Icon: Trophy,      label: 'Trade — payout' },
  ADJUSTMENT:    { Icon: Settings,    label: 'Adjustment' },
}

function meta(type) {
  return TYPE_META[type] ?? { Icon: Circle, label: type }
}

function fmtRelative(t) {
  const ms = Date.now() - new Date(t).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function TransactionList({ limit = 50 }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.transactions(limit)
      .then(d => { if (!cancelled) setRows(d) })
      .catch(e => console.error('transactions fetch failed', e))
    return () => { cancelled = true }
  }, [limit])

  if (!rows) return <div className="skeleton h-48 rounded-2xl" />
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-surface border border-border p-8 text-center text-muted">
        <Receipt size={28} strokeWidth={1.5} className="mx-auto mb-2 text-muted/70" aria-hidden="true" />
        <div className="text-sm">No transactions yet — your chip movements will show up here.</div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-surface border border-border overflow-hidden shadow-inner animate-slide-up">
      <div className="px-5 py-3.5 border-b border-border flex items-baseline justify-between">
        <div className="text-sm font-semibold">Recent activity</div>
        <div className="text-[10px] uppercase tracking-wide text-muted">Last {rows.length}</div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(r => {
          const m = meta(r.type)
          const Icon = m.Icon
          const positive = r.amount >= 0
          const RowOuter = r.marketId ? Link : 'div'
          const outerProps = r.marketId ? { to: `/market/${r.marketId}` } : {}
          return (
            <RowOuter
              {...outerProps}
              key={r.id}
              className={`flex items-center gap-3 px-5 py-3 transition ${r.marketId ? 'hover:bg-surface2 cursor-pointer' : ''}`}
            >
              <div className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 sheen ${
                positive ? 'bg-yes/10 border-yes/30 text-yes' : 'bg-no/10 border-no/30 text-no'
              }`}>
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.label}</div>
                <div className="text-[11px] text-muted truncate">
                  {r.note ?? fmtRelative(r.createdAt)}
                </div>
              </div>
              <div className="text-right shrink-0 tabular">
                <div className={`text-sm font-bold ${positive ? 'text-yes' : 'text-no'}`}>
                  {positive ? '+' : ''}{fmtChips(r.amount)}
                </div>
                <div className="text-[10px] text-muted">{fmtChips(r.balanceAfter)} after</div>
              </div>
            </RowOuter>
          )
        })}
      </ul>
    </div>
  )
}
