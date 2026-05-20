import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { CATEGORIES } from '../utils'

const TEMPLATES = [
  { description: 'Will [Team] win the IPL match on [Date]?', category: 'Cricket', outcomes: 'Yes,No', source: 'Official BCCI / IPL match result.' },
  { description: 'Will Nifty 50 close above 25,000 on [Date]?', category: 'Markets', outcomes: 'Yes,No', source: 'NSE official closing price.' },
  { description: 'Who will win the [State] assembly election?', category: 'Politics', outcomes: 'BJP,Congress,AAP,Other', source: 'ECI official result declaration.' },
  { description: 'Will RBI cut the repo rate at the next MPC?', category: 'Economy', outcomes: 'Cut,Hold,Hike', source: 'RBI MPC announcement.' },
]

export default function CreateMarket() {
  const nav = useNavigate()
  const { user } = useUser()
  const toast = useToast()
  const [form, setForm] = useState({
    description: '',
    category: 'Cricket',
    outcomes: 'Yes,No',
    days: 7,
    resolutionSource: '',
    useLsLmsr: false,
    lsAlpha: 0.05,
  })
  const [busy, setBusy] = useState(false)

  const apply = (t) => setForm({
    ...form,
    description: t.description,
    category: t.category,
    outcomes: t.outcomes,
    resolutionSource: t.source,
  })

  const submit = async () => {
    setBusy(true)
    try {
      const outcomes = form.outcomes.split(',').map(s => s.trim()).filter(Boolean)
      if (outcomes.length < 2) { toast.error('Need at least 2 outcomes'); setBusy(false); return }
      const { marketId } = await api.createMarket({
        description: form.description,
        endTime: Date.now() + Number(form.days) * 24 * 60 * 60 * 1000,
        owner: user,
        token: 'CHIPS',
        outcomes,
        category: form.category,
        resolutionSource: form.resolutionSource,
        useLsLmsr: form.useLsLmsr,
        lsAlpha: form.lsAlpha,
      })
      nav(`/market/${marketId}`)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Create a market</h1>
        <p className="text-sm text-muted">Anyone can launch a prediction. You&rsquo;ll resolve it after the event.</p>
      </div>

      {/* Templates */}
      <div>
        <div className="text-xs uppercase tracking-wide text-muted mb-2">Quick templates</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TEMPLATES.map((t, i) => (
            <button key={i} onClick={() => apply(t)} className="text-left p-3 rounded-xl bg-surface border border-border hover:border-accent/50 transition">
              <div className="text-[10px] text-accent font-semibold mb-1">{t.category}</div>
              <div className="text-sm">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-border p-5 space-y-4">
        <Field label="Question">
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="e.g. Will India win the next ODI vs Australia?"
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
            >
              {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Closes in (days)">
            <input
              type="number"
              value={form.days}
              onChange={e => setForm({ ...form, days: e.target.value })}
              min="1"
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
            />
          </Field>
        </div>
        <Field label="Outcomes (comma-separated)">
          <input
            value={form.outcomes}
            onChange={e => setForm({ ...form, outcomes: e.target.value })}
            placeholder="Yes,No"
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Resolution source">
          <input
            value={form.resolutionSource}
            onChange={e => setForm({ ...form, resolutionSource: e.target.value })}
            placeholder="What official source determines the outcome?"
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
          />
        </Field>

        {/* Pricing model — advanced */}
        <div className="rounded-xl border border-border bg-surface2/50 p-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.useLsLmsr}
              onChange={e => setForm({ ...form, useLsLmsr: e.target.checked })}
              className="mt-0.5 accent-accent"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Use Liquidity-Sensitive LMSR</div>
              <div className="text-[11px] text-muted leading-relaxed">
                Liquidity grows with volume (b ≡ α·Σq). Recommended for markets you expect to be popular —
                price stays responsive when activity is low and resists swings when it&rsquo;s high.
                Classic LMSR (default) keeps a fixed b for the whole market.
              </div>
            </div>
          </label>
          {form.useLsLmsr && (
            <div className="mt-3 pl-7">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] text-muted">α (vig / spread)</span>
                <span className="text-[11px] font-mono">{form.lsAlpha.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.20"
                step="0.005"
                value={form.lsAlpha}
                onChange={e => setForm({ ...form, lsAlpha: Number(e.target.value) })}
                className="w-full accent-accent"
              />
              <div className="text-[10px] text-muted mt-1">
                Smaller α = tighter spread but slower-growing liquidity. 0.05 is a sensible default.
              </div>
            </div>
          )}
        </div>

        <button
          onClick={submit}
          disabled={busy || !form.description}
          className="w-full py-3 rounded-xl bg-accent text-white font-bold hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {busy ? 'Creating…' : 'Launch market'}
        </button>
      </div>
    </div>
  )
}

const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-xs text-muted mb-1.5">{label}</div>
    {children}
  </label>
)
