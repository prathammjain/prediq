import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Trophy, ArrowRight, Gavel, Clock, Coins } from 'lucide-react'
import { api } from '../api'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { fmtChips, categoryColor } from '../utils'
import StatsPanel from '../components/StatsPanel.jsx'
import BadgeGrid from '../components/BadgeGrid.jsx'
import TransactionList from '../components/TransactionList.jsx'

const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'stats',     label: 'Skill' },
  { id: 'badges',    label: 'Badges' },
  { id: 'activity',  label: 'Activity' },
]

export default function Portfolio() {
  const { user, balance, refreshBalance, actions, refreshActions } = useUser()
  const toast = useToast()
  const [claimingAll, setClaimingAll] = useState(false)
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('positions')

  const load = () => {
    setLoading(true)
    api.positions()
      .then(setPositions)
      .catch(e => console.error('positions fetch failed', e))
      .finally(() => setLoading(false))
  }
  useEffect(load, [user])

  const open = positions.filter(p => !p.resolved)
  const claimable = positions.filter(p => p.claimable)
  const settled = positions.filter(p => p.resolved && !p.claimable)

  const totalCost = open.reduce((s, p) => s + p.chipsSpent, 0)
  const totalMark = open.reduce((s, p) => s + p.markValue, 0)
  const totalPnL = totalMark - totalCost
  const totalClaimable = claimable.reduce((s, p) => s + p.potentialPayout, 0)

  const claim = async (id) => {
    try {
      const r = await api.claim(id)
      await Promise.all([refreshBalance(), refreshActions()])
      load()
      if (r.payout > 0) toast.success({ title: 'Payout claimed', body: `${fmtChips(r.payout)} added to your balance.` })
      else toast.info('No winnings on this market.')
    } catch (e) { toast.error(e.message) }
  }

  const claimAll = async () => {
    setClaimingAll(true)
    try {
      const r = await api.claimAll()
      await Promise.all([refreshBalance(), refreshActions()])
      load()
      if (r.claimedMarkets > 0) {
        toast.success({
          title: `Claimed ${r.claimedMarkets} payout${r.claimedMarkets === 1 ? '' : 's'}`,
          body: `${fmtChips(r.totalPayout)} added to your balance.`,
        })
      } else {
        toast.info('Nothing to claim.')
      }
    } catch (e) { toast.error(e.message) }
    finally { setClaimingAll(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{user}&rsquo;s Portfolio</h1>
        <p className="text-sm text-muted">Your share positions, mark-to-market P&amp;L, and unclaimed payouts.</p>
      </div>

      {actions && actions.total > 0 && (
        <ActionCenter actions={actions} onClaimAll={claimAll} claimingAll={claimingAll} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Chips" value={fmtChips(balance)} />
        <Stat label="Cost basis" value={fmtChips(totalCost)} />
        <Stat label="Mark value" value={fmtChips(totalMark)} accent />
        <Stat
          label={totalClaimable > 0 ? 'Ready to claim' : 'Unrealized P&L'}
          value={totalClaimable > 0 ? fmtChips(totalClaimable) : `${totalPnL >= 0 ? '+' : ''}${fmtChips(totalPnL)}`}
          highlight={totalClaimable > 0}
          pnl={totalClaimable === 0 ? totalPnL : 0}
        />
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 p-1 rounded-xl bg-surface border border-border w-fit shadow-inner">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-accent/20 text-accent shadow-[inset_0_0_0_1px_rgba(99,102,241,0.35)]'
                : 'text-muted hover:text-text hover:bg-surface2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'positions' && (
        <div className="animate-fade-in">
          {loading ? (
            <div className="skeleton h-40 rounded-2xl" />
          ) : positions.length === 0 ? (
            <div className="text-center py-16 text-muted rounded-2xl bg-surface/40 border border-dashed border-border">
              <Inbox size={36} strokeWidth={1.25} className="mx-auto mb-3 text-muted/70" aria-hidden="true" />
              <div className="text-sm mb-1 text-text">No positions yet</div>
              <div className="text-xs mb-4">Pick a market and place your first prediction.</div>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition shadow-glow"
              >
                Browse markets <ArrowRight size={14} strokeWidth={2.25} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {claimable.length > 0 && (
                <Section title={<><Trophy size={12} strokeWidth={2} className="inline-block mr-1.5 -mt-0.5 text-saffron" aria-hidden="true" />Ready to claim</>} rows={claimable} action={(p) => (
                  <button
                    onClick={(e) => { e.preventDefault(); claim(p.marketId) }}
                    className="px-3 py-1.5 rounded-lg bg-saffron text-bg text-xs font-bold active:scale-[0.98] hover:bg-orange-400 transition"
                  >
                    Claim {fmtChips(p.potentialPayout)}
                  </button>
                )} />
              )}
              {open.length > 0 && <Section title="Active positions" rows={open} />}
              {settled.length > 0 && <Section title="Settled" rows={settled} muted />}
            </div>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="animate-fade-in">
          <StatsPanel user={user} />
        </div>
      )}

      {tab === 'badges' && (
        <div className="animate-fade-in">
          <BadgeGrid user={user} />
        </div>
      )}

      {tab === 'activity' && (
        <div className="animate-fade-in">
          <TransactionList limit={50} />
        </div>
      )}
    </div>
  )
}

// Surfaces the three things a user might need to do across all their
// markets: claim winnings, propose a winner on a market they own, or
// weigh in on a dispute window that's open on a stake they hold.
function ActionCenter({ actions, onClaimAll, claimingAll }) {
  const { claimable, needsProposal, openDisputes } = actions
  return (
    <section className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 via-surface to-saffron/5 p-4 sm:p-5 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-accent inline-flex items-center gap-1.5">
          <Gavel size={13} strokeWidth={2.25} aria-hidden="true" />
          Action center
        </h2>
        <span className="text-[10px] text-muted">{actions.total} pending</span>
      </div>

      {claimable.count > 0 && (
        <div className="rounded-xl bg-saffron/10 border border-saffron/40 p-3 flex items-center gap-3">
          <Coins size={18} strokeWidth={2} className="text-saffron shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {claimable.count} winning position{claimable.count === 1 ? '' : 's'} ready —{' '}
              <span className="text-saffron">{fmtChips(claimable.totalChips)}</span>
            </div>
            <div className="text-[11px] text-muted">Each winning share pays 1 chip into your balance.</div>
          </div>
          <button
            onClick={onClaimAll}
            disabled={claimingAll}
            className="px-3 py-1.5 rounded-lg bg-saffron text-bg text-xs font-bold whitespace-nowrap active:scale-[0.98] hover:bg-orange-400 transition disabled:opacity-60"
          >
            {claimingAll ? 'Claiming…' : 'Claim all'}
          </button>
        </div>
      )}

      {needsProposal.count > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Gavel size={15} strokeWidth={2} className="text-amber-300 shrink-0" aria-hidden="true" />
            <div className="text-sm font-semibold">
              {needsProposal.count} market{needsProposal.count === 1 ? '' : 's'} you own need{needsProposal.count === 1 ? 's' : ''} a winner
            </div>
          </div>
          <ul className="space-y-1.5 pl-6">
            {needsProposal.items.slice(0, 3).map(m => (
              <li key={m.marketId}>
                <Link to={`/market/${m.marketId}`} className="text-[12px] text-muted hover:text-accent inline-flex items-center gap-1">
                  <span className="truncate max-w-[40ch]">{m.description}</span>
                  <ArrowRight size={11} strokeWidth={2.25} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openDisputes.count > 0 && (
        <div className="rounded-xl bg-no/10 border border-no/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Clock size={15} strokeWidth={2} className="text-no shrink-0" aria-hidden="true" />
            <div className="text-sm font-semibold">
              {openDisputes.count} dispute window{openDisputes.count === 1 ? '' : 's'} open on your stakes
            </div>
          </div>
          <ul className="space-y-1.5 pl-6">
            {openDisputes.items.slice(0, 3).map(m => (
              <li key={m.marketId} className="text-[12px]">
                <Link to={`/market/${m.marketId}`} className="text-muted hover:text-accent inline-flex items-center gap-1">
                  <span className="truncate max-w-[40ch]">{m.description}</span>
                  <ArrowRight size={11} strokeWidth={2.25} aria-hidden="true" />
                </Link>
                <span className="ml-1.5 text-[10px] text-no font-mono">
                  closes <Countdown to={new Date(m.disputeUntil).getTime()} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Countdown({ to }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const ms = to - Date.now()
  if (ms <= 0) return <span>now</span>
  const m = Math.floor(ms / 60_000)
  if (m < 60) return <span>in {m}m</span>
  const h = Math.floor(m / 60)
  return <span>in {h}h {m % 60}m</span>
}

const Stat = ({ label, value, accent, highlight, pnl }) => {
  const bg = highlight
    ? 'bg-gradient-to-br from-saffron/15 to-saffron/5 border-saffron/40'
    : pnl !== undefined && pnl !== 0
      ? pnl > 0 ? 'bg-gradient-to-br from-yes/10 to-yes/5 border-yes/30' : 'bg-gradient-to-br from-no/10 to-no/5 border-no/30'
      : accent
        ? 'bg-gradient-to-br from-accent/15 to-accent/5 border-accent/30'
        : 'bg-surface border-border'
  const fg = highlight
    ? 'text-saffron'
    : pnl !== undefined && pnl !== 0
      ? pnl > 0 ? 'text-yes' : 'text-no'
      : accent
        ? 'text-accent'
        : 'text-text'
  return (
    <div className={`rounded-xl border p-3.5 shadow-inner card-lift ${bg}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular ${fg}`}>{value}</div>
    </div>
  )
}

const Section = ({ title, rows, action, muted }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-muted mb-2 font-semibold">{title}</div>
    <div className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-inner">
      {rows.map((p, i) => (
        <Link
          key={`${p.marketId}-${p.outcomeIndex}-${i}`}
          to={`/market/${p.marketId}`}
          className={`flex items-center gap-3 p-3.5 hover:bg-surface2/80 transition-colors ${muted ? 'opacity-70' : ''}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${categoryColor(p.category)}`}>{p.category}</span>
              <span className="text-[11px] text-muted">on &ldquo;{p.outcomeName}&rdquo;</span>
              {p.status === 'PROPOSED' && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">PROPOSED</span>
              )}
              {p.status === 'DISPUTED' && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-no/20 text-no">DISPUTED</span>
              )}
              {p.resolved && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${p.won ? 'bg-yes/20 text-yes' : 'bg-no/20 text-no'}`}>
                  {p.won ? 'WON' : 'LOST'}
                </span>
              )}
            </div>
            <div className="text-sm font-medium truncate">{p.description}</div>
            <div className="text-[11px] text-muted mt-0.5 font-mono">
              {p.shares.toFixed(1)} shares @ {Math.round(p.avgCost * 100)}¢
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted">{p.resolved ? 'Final' : 'Mark'}</div>
            <div className="text-sm font-mono font-semibold">{fmtChips(p.resolved ? (p.won ? p.potentialPayout : 0) : p.markValue)}</div>
            {!p.resolved && (
              <div className={`text-[10px] font-mono ${p.unrealizedPnL >= 0 ? 'text-yes' : 'text-no'}`}>
                {p.unrealizedPnL >= 0 ? '+' : ''}{fmtChips(p.unrealizedPnL)}
              </div>
            )}
          </div>
          {action && action(p)}
        </Link>
      ))}
    </div>
  </div>
)
