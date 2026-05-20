import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { fmtChips, fmtPct } from '../utils'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { api } from '../api'

// Sell shares of a held outcome back to the LMSR for chips. The user picks
// a share count (or "Sell all"); we live-preview the refund and the
// post-trade probability.
//
// Props:
//   market        — full Market object with outcomes / percents
//   position      — SharePosition on (market, outcomeIndex). Required; this
//                   modal is only opened from a held outcome row.
export default function SellModal({ market, position, onClose, onPlaced }) {
  const { applyBalanceDelta } = useUser()
  const toast = useToast()

  const outcomeIndex = position.outcomeIndex
  const outcomeName = market.outcomes[outcomeIndex]
  const owned = position.shares

  const [shares, setShares] = useState(() => Math.floor(owned * 1000) / 1000)
  const [preview, setPreview] = useState(null)

  const tooMany = shares > owned + 1e-6
  const invalid = !(shares > 0) || tooMany || !preview

  useEffect(() => {
    if (!(shares > 0) || tooMany) { setPreview(null); return }
    let cancelled = false
    const h = setTimeout(() => {
      api.sellPreview(market.id, { outcome: outcomeIndex, shares: Number(shares) })
        .then(p => { if (!cancelled) setPreview(p) })
        .catch(() => {})
    }, 120)
    return () => { cancelled = true; clearTimeout(h) }
  }, [shares, market.id, outcomeIndex, tooMany])

  // Optimistic: credit the preview refund instantly so the header chips
  // counter jumps the moment the user clicks. When the API returns, we
  // reconcile any drift (preview vs actual fill — usually pennies). On
  // failure we back out the optimistic credit.
  const place = () => {
    if (invalid) return
    const optimistic = preview.refund
    const sharesNum = Number(shares)
    applyBalanceDelta(optimistic)
    onClose()
    api.sell(market.id, { outcome: outcomeIndex, shares: sharesNum })
      .then(r => {
        const drift = r.refund - optimistic
        if (Math.abs(drift) > 0.005) applyBalanceDelta(drift)
        toast.success({ title: 'Position reduced', body: `${fmtChips(r.refund)} returned at ${(r.avgFillPrice * 100).toFixed(0)}¢/share.` })
        onPlaced?.()
      })
      .catch(err => {
        applyBalanceDelta(-optimistic)
        toast.error({ title: 'Sell failed', body: err.message })
      })
  }

  // Lock body scroll while open + ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const refund = preview?.refund ?? 0
  const profit = refund - position.chipsSpent * (shares / owned)  // pro-rated cost basis
  const fillPriceCents = preview ? Math.round(preview.avgFillPrice * 100) : null

  return (
    <div className="fixed inset-0 z-50 modal-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-surface border border-border sm:rounded-2xl rounded-t-2xl shadow-card overflow-hidden animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] text-muted uppercase tracking-widest font-semibold">Sell &ldquo;{outcomeName}&rdquo;</div>
              <div className="text-base font-semibold leading-snug mt-1 line-clamp-2">{market.description}</div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-muted hover:text-text p-1.5 -m-1 rounded-lg hover:bg-surface2 transition"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Sell (shares)</span>
              <span className="tabular">Holding: {owned.toFixed(2)}</span>
            </div>
            <input
              type="number"
              value={shares}
              step="any"
              onChange={e => setShares(Math.max(0, Number(e.target.value) || 0))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-3 text-xl font-bold focus:outline-none focus:border-accent/60 tabular"
              inputMode="decimal"
            />
            <div className="flex gap-1.5">
              {[0.25, 0.5, 0.75].map(frac => (
                <button
                  key={frac}
                  onClick={() => setShares(Math.floor(owned * frac * 1000) / 1000)}
                  className="flex-1 py-2 text-xs rounded-lg bg-surface2 border border-border hover:border-accent/50 text-muted hover:text-text transition"
                >
                  {Math.round(frac * 100)}%
                </button>
              ))}
              <button
                onClick={() => setShares(Math.floor(owned * 1000) / 1000)}
                className="flex-1 py-2 text-xs rounded-lg bg-no/10 border border-no/40 hover:bg-no/20 text-no font-semibold transition"
              >
                Sell all
              </button>
            </div>
            {tooMany && (
              <div className="text-xs text-no">You only hold {owned.toFixed(2)} shares of this outcome.</div>
            )}
          </div>

          {/* Preview */}
          <div className="mt-5 rounded-xl bg-surface2/50 border border-border p-3.5 space-y-2 text-sm">
            <Row label="Refund" value={preview ? fmtChips(refund) : '—'} bold />
            <Row label="Fill price" value={fillPriceCents != null ? `${fillPriceCents}¢/share` : '—'} />
            <Row
              label="Realised P&L (this slice)"
              value={preview ? `${profit >= 0 ? '+' : ''}${fmtChips(profit)}` : '—'}
              tone={preview ? (profit >= 0 ? 'pos' : 'neg') : null}
            />
            <Row
              label={`New ${outcomeName} probability`}
              value={preview ? fmtPct(preview.newPercents[outcomeIndex]) : '—'}
            />
          </div>

          <button
            onClick={place}
            disabled={invalid}
            className="w-full mt-5 py-3 rounded-xl bg-no/15 border border-no/50 text-no font-bold text-sm hover:bg-no/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {preview ? `Sell for ${fmtChips(refund)}` : 'Sell'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Row = ({ label, value, bold, tone }) => {
  const toneCls = tone === 'pos' ? 'text-yes' : tone === 'neg' ? 'text-no' : 'text-text'
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular font-mono ${bold ? 'font-bold text-base' : ''} ${toneCls}`}>{value}</span>
    </div>
  )
}
