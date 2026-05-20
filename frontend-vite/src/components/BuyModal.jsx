import React, { useState, useEffect } from 'react'
import { X, Sparkles } from 'lucide-react'
import { fmtChips, fmtPct } from '../utils'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { api } from '../api'

// LMSR-aware buy modal: calls /preview live as the user types, shows
// shares + fill price + potential payout (1 chip per winning share).
export default function BuyModal({ market, outcomeIndex, onClose, onPlaced }) {
  const { balance, applyBalanceDelta, setBalance, markFirstTrade, isNewUser } = useUser()
  const toast = useToast()
  const [chips, setChips] = useState(100)
  const [preview, setPreview] = useState(null)

  const outcomeName = market.outcomes[outcomeIndex]
  const tooMuch = chips > balance
  const invalid = chips <= 0 || tooMuch

  // Debounced live preview of the LMSR fill.
  useEffect(() => {
    if (!(chips > 0)) { setPreview(null); return }
    let cancelled = false
    const h = setTimeout(() => {
      api.preview(market.id, { outcome: outcomeIndex, chips: Number(chips) })
        .then(p => { if (!cancelled) setPreview(p) })
        .catch(() => {})
    }, 120)
    return () => { cancelled = true; clearTimeout(h) }
  }, [chips, market.id, outcomeIndex])

  // Optimistic: decrement balance locally, close modal, fire trade in the
  // background. The header chips counter updates instantly. On API failure
  // we revert the delta and surface the error via toast (the modal is
  // already closed by then, so an inline error wouldn't be seen).
  const place = () => {
    const stake = Number(chips)
    if (!(stake > 0) || stake > balance) return
    applyBalanceDelta(-stake)
    if (isNewUser) markFirstTrade()
    onClose()
    api.trade(market.id, { outcome: outcomeIndex, chips: stake })
      .then(r => {
        // Reconcile the optimistic `stake` debit with the authoritative
        // balance from the server (LMSR fills slightly under the worst-case
        // stake so the actual debit is a hair smaller).
        if (typeof r?.balance === 'number') setBalance(r.balance)
        onPlaced?.()
      })
      .catch(err => {
        applyBalanceDelta(stake)  // revert
        toast.error({ title: 'Trade failed', body: err.message })
      })
  }

  const isYesNo = market.outcomes.length === 2
  const accent = isYesNo && outcomeIndex === 0
    ? 'bg-yes hover:bg-emerald-600'
    : isYesNo && outcomeIndex === 1
      ? 'bg-no hover:bg-red-600'
      : 'bg-accent hover:bg-indigo-500'

  const potentialPayout = preview?.potentialPayoutIfWin ?? 0
  const profit = potentialPayout - chips
  const multiplier = chips > 0 && potentialPayout > 0 ? potentialPayout / chips : 0
  const fillPriceCents = preview ? Math.round(preview.avgFillPrice * 100) : null

  return (
    <div className="fixed inset-0 z-50 modal-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-surface border border-border sm:rounded-2xl rounded-t-2xl shadow-card overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-muted uppercase tracking-wide">Buy &ldquo;{outcomeName}&rdquo;</div>
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
              <span>Spend (chips)</span>
              <span>Balance: {fmtChips(balance)}</span>
            </div>
            <input
              type="number"
              value={chips}
              onChange={e => setChips(Math.max(0, Number(e.target.value) || 0))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-3 text-xl font-bold focus:outline-none focus:border-accent/60"
              inputMode="numeric"
            />
            <div className="flex gap-1.5">
              {[50, 100, 500, 1000].map(v => (
                <button
                  key={v}
                  onClick={() => setChips(v)}
                  className="flex-1 py-2 text-xs rounded-lg bg-surface2 border border-border hover:border-accent/50 text-muted hover:text-text"
                >
                  {v}
                </button>
              ))}
              <button
                onClick={() => setChips(Math.floor(balance))}
                className="flex-1 py-2 text-xs rounded-lg bg-surface2 border border-border hover:border-accent/50 text-muted hover:text-text"
              >
                Max
              </button>
            </div>
          </div>

          {/* LMSR preview */}
          <div className="mt-5 rounded-xl bg-surface2 border border-border p-3.5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Current price</span>
              <span className="font-mono">
                {Math.round(market.percents[outcomeIndex] * 100)}¢
                <span className="text-muted ml-1">({fmtPct(market.percents[outcomeIndex])})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Avg fill price</span>
              <span className="font-mono">{fillPriceCents !== null ? `${fillPriceCents}¢` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Shares</span>
              <span className="font-mono">{preview ? preview.shares.toFixed(1) : '—'}</span>
            </div>
            <div className="h-px bg-border my-1" />
            <div className="flex justify-between">
              <span className="text-muted">Payout if wins</span>
              <span className="font-mono text-text font-semibold">{fmtChips(potentialPayout)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Max profit</span>
              <span className={`font-mono font-semibold ${profit >= 0 ? 'text-yes' : 'text-no'}`}>
                {profit >= 0 ? '+' : ''}{fmtChips(profit)}{multiplier > 0 ? ` (${multiplier.toFixed(2)}×)` : ''}
              </span>
            </div>
          </div>

          {tooMuch && (
            <div className="mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
              Not enough chips. Try a smaller amount or claim your daily bonus.
            </div>
          )}

          {isNewUser && (
            <div className="mt-4 rounded-xl bg-accent/10 border border-accent/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent">
                <Sparkles size={10} strokeWidth={2.5} aria-hidden="true" />
                First trade — quick primer
              </div>
              <ul className="text-[11px] text-muted leading-snug space-y-1 list-disc pl-4">
                <li><span className="text-text font-semibold">Price = probability.</span> A 32¢ share = the market thinks there’s a 32% chance.</li>
                <li><span className="text-text font-semibold">Cheaper = bigger payout.</span> Each winning share always pays exactly 1 chip.</li>
                <li><span className="text-text font-semibold">You can sell anytime</span> before the market closes if the price moves your way.</li>
              </ul>
            </div>
          )}

          <button
            onClick={place}
            disabled={invalid}
            className={`mt-4 w-full py-3.5 rounded-xl font-bold text-white transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${accent}`}
          >
            Buy {outcomeName} · {fmtChips(chips)}
          </button>
          {!isNewUser && (
            <p className="mt-3 text-[10px] text-muted text-center leading-snug">
              Each winning share pays 1 chip at resolution. Prices update instantly using LMSR.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
