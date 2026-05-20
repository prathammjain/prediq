import React, { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Flag, Check, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { fmtChips, fmtPct, fmtRelative, categoryColor } from '../utils'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import Sparkline from '../components/Sparkline.jsx'
import BuyModal from '../components/BuyModal.jsx'
import SellModal from '../components/SellModal.jsx'

export default function MarketDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { me, user, refreshBalance, refreshActions } = useUser()
  const toast = useToast()
  const [market, setMarket] = useState(null)
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [buyIdx, setBuyIdx] = useState(null)
  const [sellPos, setSellPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  const load = () => {
    setLoading(true)
    // Positions endpoint requires auth; fall back to [] for signed-out viewers.
    const positionsP = me ? api.positions().catch(() => []) : Promise.resolve([])
    Promise.all([api.getMarket(id), positionsP])
      .then(([m, ps]) => {
        setMarket(m)
        setPositions(ps.filter(p => p.marketId === m.id))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [id, me?.handle])

  // Tick once a second so the dispute countdown updates live.
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [])

  // Real-time updates via SSE — merge price/status pushes into the
  // existing market state without re-fetching the whole record. We
  // append a synthetic history point on each price tick so the
  // sparkline animates live.
  useEffect(() => {
    if (!id) return
    const es = new EventSource(`/api/markets/${id}/stream`)
    const onPrice = (e) => {
      try {
        const data = JSON.parse(e.data)
        setMarket(prev => prev && {
          ...prev,
          percents: data.percents,
          sharesOutstanding: data.sharesOutstanding,
          volume: data.volume ?? prev.volume,
          history: [...(prev.history ?? []), { t: data.t, percents: data.percents }].slice(-200),
        })
      } catch {}
    }
    const onStatus = (e) => {
      try {
        const data = JSON.parse(e.data)
        setMarket(prev => prev && {
          ...prev,
          status: data.status ?? prev.status,
          proposedOutcomeIndex: data.proposedOutcomeIndex ?? prev.proposedOutcomeIndex,
          disputeUntil: data.disputeUntil ?? prev.disputeUntil,
          resolvedOutcomeIndex: data.resolvedOutcomeIndex ?? prev.resolvedOutcomeIndex,
        })
      } catch {}
    }
    es.addEventListener('price', onPrice)
    es.addEventListener('status', onStatus)
    es.addEventListener('snapshot', onPrice)  // same shape — initial state
    return () => {
      es.removeEventListener('price', onPrice)
      es.removeEventListener('status', onStatus)
      es.removeEventListener('snapshot', onPrice)
      es.close()
    }
  }, [id])

  if (loading) return <div className="skeleton h-96 rounded-2xl" />
  if (error) return <div className="text-no">{error}</div>
  if (!market) return null

  const ended = now >= market.endTime
  const isResolved = market.status === 'RESOLVED'
  const isProposed = market.status === 'PROPOSED'
  const isDisputed = market.status === 'DISPUTED'
  const canBuy = market.status === 'LIVE' && !ended
  const isCreator = me && market.owner === me.handle
  const isAdmin = me?.role === 'ADMIN'

  // Buy is only meaningful when authenticated. Unauthed clicks bounce to
  // /login with `?next=` so the user lands back here after sign-in.
  const tryBuy = (idx) => {
    if (!me) return nav(`/login?next=${encodeURIComponent(`/market/${id}`)}`)
    setBuyIdx(idx)
  }
  const disputeMsLeft = isProposed && market.disputeUntil ? market.disputeUntil - now : 0
  const disputeWindowOpen = isProposed && disputeMsLeft > 0
  const canFinalize = isProposed && disputeMsLeft <= 0

  const claim = async () => {
    setBusy(true)
    try {
      const r = await api.claim(market.id)
      await Promise.all([refreshBalance(), refreshActions()])
      load()
      if (r.payout > 0) toast.success({ title: 'Payout claimed', body: `${fmtChips(r.payout)} added to your balance.` })
      else toast.info('Nothing to claim on this market.')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const propose = async (idx) => {
    if (!confirm(`Propose "${market.outcomes[idx]}" as the winning outcome? A 24h dispute window opens.`)) return
    setBusy(true)
    try {
      await api.propose(market.id, idx)
      toast.success('Resolution proposed. Dispute window now open.')
      load(); refreshActions()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const dispute = async () => {
    if (!confirm('Flag this resolution as wrong? An admin will review.')) return
    setBusy(true)
    try {
      await api.dispute(market.id)
      toast.info('Dispute filed. An admin will finalize.')
      load(); refreshActions()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const finalize = async (idx) => {
    setBusy(true)
    try {
      await api.finalize(market.id, idx)
      toast.success('Market resolved. Payouts are claimable.')
      load(); refreshActions()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const totalShares = positions.reduce((s, p) => s + p.shares, 0)
  const winningPos = isResolved
    ? positions.find(p => p.outcomeIndex === market.resolvedOutcomeIndex && !p.claimed && p.shares > 0)
    : null

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-muted hover:text-text inline-flex items-center gap-1">← Back to markets</Link>

      {/* Header */}
      <div className="rounded-2xl bg-surface border border-border p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${categoryColor(market.category)}`}>
            {market.category}
          </span>
          <StatusPill market={market} ended={ended} now={now} />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold leading-snug">{market.description}</h1>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          {market.useLsLmsr ? (
            <span title="Liquidity-Sensitive LMSR — b grows with volume">
              <span className="text-accent font-semibold">LS-LMSR</span>
              <span className="ml-1">α={market.lsAlpha?.toFixed(3) ?? '0.05'}, b₀={market.liquidityB}</span>
            </span>
          ) : (
            <span title="Classic LMSR — fixed liquidity parameter">
              <span className="text-text font-semibold">LMSR</span>
              <span className="ml-1">b={market.liquidityB}</span>
            </span>
          )}
          <span>Created by <span className="text-text">{market.owner}</span></span>
          <span>{ended ? 'Closed' : 'Closes'} {new Date(market.endTime).toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-2xl bg-surface border border-border p-5">
        <div className="text-xs text-muted uppercase tracking-wide mb-3">Probability over time</div>
        <Sparkline history={market.history} outcomes={market.outcomes} />
      </div>

      {/* Outcomes / Buy */}
      <div className="rounded-2xl bg-surface border border-border p-5 space-y-3">
        <div className="text-xs text-muted uppercase tracking-wide">Outcomes</div>
        {market.outcomes.map((name, i) => {
          const pct = market.percents[i]
          const isYesNo = market.outcomes.length === 2
          const winner = isResolved && market.resolvedOutcomeIndex === i
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold truncate flex items-center gap-1.5">
                    {name}
                    {winner && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yes/20 text-yes">WINNER</span>}
                  </span>
                  <span className="font-mono text-text">{Math.round(pct * 100)}¢</span>
                </div>
                <div className="h-2 rounded-full bg-surface2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct * 100, 2)}%`,
                      background: isYesNo && i === 0 ? '#22c55e' : isYesNo && i === 1 ? '#ef4444' : '#6366f1',
                    }}
                  />
                </div>
              </div>
              <button
                disabled={!canBuy}
                onClick={() => tryBuy(i)}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                  isYesNo && i === 0 ? 'bg-yes hover:bg-emerald-600'
                    : isYesNo && i === 1 ? 'bg-no hover:bg-red-600'
                      : 'bg-accent hover:bg-indigo-500'
                }`}
              >
                Buy {name}
              </button>
            </div>
          )
        })}
      </div>

      {/* Your position */}
      {totalShares > 0 && (
        <div className="rounded-2xl bg-surface border border-border p-5 space-y-2">
          <div className="text-[11px] text-muted uppercase tracking-widest font-semibold">Your position</div>
          {positions.filter(p => p.shares > 0).map(p => (
            <div key={p.outcomeIndex} className="flex items-center gap-3 text-sm py-1.5">
              <div className="flex-1 min-w-0">
                <div className="truncate"><span className="text-muted">on </span><span className="font-semibold">{p.outcomeName}</span></div>
              </div>
              <div className="text-right font-mono tabular shrink-0">
                <div className="text-[10px] text-muted uppercase">Shares</div>
                <div className="font-semibold">{p.shares.toFixed(1)}</div>
              </div>
              <div className="text-right font-mono tabular shrink-0 min-w-[72px]">
                <div className="text-[10px] text-muted uppercase">P&amp;L</div>
                <div className={p.unrealizedPnL >= 0 ? 'text-yes' : 'text-no'}>
                  {p.unrealizedPnL >= 0 ? '+' : ''}{fmtChips(p.unrealizedPnL)}
                </div>
              </div>
              {canBuy && (
                <button
                  onClick={() => setSellPos(p)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-no/10 border border-no/40 text-no text-xs font-bold hover:bg-no/20 transition active:scale-[0.98]"
                >
                  Sell
                </button>
              )}
            </div>
          ))}
          {winningPos && (
            <button
              onClick={claim}
              disabled={busy}
              className="w-full mt-2 py-2.5 rounded-lg bg-saffron text-bg font-bold hover:bg-orange-400 transition disabled:opacity-50"
            >
              Claim {fmtChips(winningPos.shares)}
            </button>
          )}
        </div>
      )}

      {/* Resolution source */}
      {market.resolutionSource && (
        <div className="rounded-2xl bg-surface border border-border p-5">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Resolution source</div>
          <div className="text-sm text-text">{market.resolutionSource}</div>
        </div>
      )}

      {/* Proposed: dispute window UI */}
      {isProposed && (
        <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-5 space-y-2">
          <div className="text-xs text-amber-300 uppercase tracking-wide">Resolution proposed</div>
          <div className="text-sm">
            Proposed winner: <span className="font-semibold">&ldquo;{market.outcomes[market.proposedOutcomeIndex]}&rdquo;</span>
          </div>
          <div className="text-xs text-muted">
            {disputeWindowOpen
              ? <>Dispute window closes in <span className="font-mono text-amber-300">{fmtCountdown(disputeMsLeft)}</span>.</>
              : 'Dispute window has closed. Anyone can finalize.'}
          </div>
          <div className="flex gap-2 pt-1">
            {disputeWindowOpen && (
              <button
                onClick={dispute}
                disabled={busy}
                className="flex-1 py-2 rounded-lg bg-no/10 border border-no/40 text-no font-semibold text-sm hover:bg-no/20 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <Flag size={13} strokeWidth={2} aria-hidden="true" />
                Dispute
              </button>
            )}
            {canFinalize && (
              <button
                onClick={() => finalize(market.proposedOutcomeIndex)}
                disabled={busy}
                className="flex-1 py-2 rounded-lg bg-yes/10 border border-yes/40 text-yes font-semibold text-sm hover:bg-yes/20 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <Check size={13} strokeWidth={2.25} aria-hidden="true" />
                Finalize
              </button>
            )}
          </div>
        </div>
      )}

      {/* Disputed: admin override */}
      {isDisputed && isAdmin && (
        <div className="rounded-2xl bg-no/5 border border-no/30 p-5 space-y-2">
          <div className="text-xs text-no uppercase tracking-wide">Admin override (disputed)</div>
          <div className="text-sm text-muted">Pick the correct outcome to finalize.</div>
          <div className="flex flex-wrap gap-2">
            {market.outcomes.map((name, i) => (
              <button
                key={i}
                onClick={() => finalize(i)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-surface2 border border-border hover:border-no/50 text-sm font-semibold disabled:opacity-50"
              >
                Finalize as &ldquo;{name}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}
      {isDisputed && !isAdmin && (
        <div className="rounded-2xl bg-no/5 border border-no/30 p-5 text-sm text-muted flex items-center gap-2">
          <Flag size={14} strokeWidth={2} className="text-no shrink-0" aria-hidden="true" />
          This resolution is disputed. An admin will finalize.
        </div>
      )}

      {/* Creator: propose resolution (LIVE or CLOSED) */}
      {(isCreator || isAdmin) && (market.status === 'LIVE' || market.status === 'CLOSED') && (
        <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-5 space-y-2">
          <div className="text-xs text-amber-300 uppercase tracking-wide">Creator controls</div>
          <div className="text-sm text-muted">Propose the winning outcome. A 24h dispute window opens before payout.</div>
          <div className="flex flex-wrap gap-2">
            {market.outcomes.map((name, i) => (
              <button
                key={i}
                onClick={() => propose(i)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-surface2 border border-border hover:border-amber-500/50 text-sm font-semibold disabled:opacity-50"
              >
                Propose &ldquo;{name}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}

      {buyIdx !== null && (
        <BuyModal
          market={market}
          outcomeIndex={buyIdx}
          onClose={() => setBuyIdx(null)}
          onPlaced={load}
        />
      )}

      {sellPos && (
        <SellModal
          market={market}
          position={sellPos}
          onClose={() => setSellPos(null)}
          onPlaced={load}
        />
      )}
    </div>
  )
}

function StatusPill({ market, ended, now }) {
  const base = 'text-[10px] font-semibold px-2 py-0.5 rounded-full border'
  if (market.status === 'RESOLVED') {
    return (
      <span className={`${base} bg-emerald-500/15 text-emerald-300 border-emerald-500/30`}>
        RESOLVED · {market.outcomes[market.resolvedOutcomeIndex]}
      </span>
    )
  }
  if (market.status === 'DISPUTED') {
    return <span className={`${base} bg-no/15 text-no border-no/40 inline-flex items-center gap-1`}><Flag size={10} strokeWidth={2.5} aria-hidden="true" />DISPUTED</span>
  }
  if (market.status === 'PROPOSED') {
    const ms = market.disputeUntil ? market.disputeUntil - now : 0
    return (
      <span className={`${base} bg-amber-500/15 text-amber-300 border-amber-500/30`}>
        PROPOSED{ms > 0 ? ` · ${fmtCountdown(ms)} left` : ' · ready'}
      </span>
    )
  }
  if (ended) {
    return <span className={`${base} bg-amber-500/15 text-amber-300 border-amber-500/30`}>AWAITING RESOLUTION</span>
  }
  return (
    <span className={`${base} bg-accent/15 text-accent border-accent/40`}>
      LIVE · {fmtRelative(market.endTime)}
    </span>
  )
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
