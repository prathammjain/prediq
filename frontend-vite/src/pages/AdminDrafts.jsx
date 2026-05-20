import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, CheckCircle2, AlertTriangle, ExternalLink, ArrowRight, Loader2 } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../state/ToastContext.jsx'
import { CATEGORIES, fmtChips } from '../utils'

// AdminDrafts — triage queue for AI-generated MarketDraft proposals.
//
// Auth/role gating is handled by the <Protected adminOnly> wrapper in
// App.jsx, so this component can assume the caller is an admin. Each
// draft is editable in place; "Approve" creates a real Market using the
// edited fields, "Reject" marks the row REJECTED. A "Run ingest now"
// button kicks the RSS → Mistral pipeline on demand.
//
// Bulk-select + bulk-reject is provided for clearing out batches of
// low-quality drafts (the placeholder Slice-1 leftovers are a typical
// case).

export default function AdminDrafts() {
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('PENDING')  // PENDING | APPROVED | REJECTED
  const [drafts, setDrafts] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ingestResult, setIngestResult] = useState(null)
  const [selected, setSelected] = useState(() => new Set())

  const load = () => {
    setDrafts(null)
    setNextCursor(null)
    api.admin.listDrafts(tab).then(({ items, nextCursor }) => {
      setDrafts(items)
      setNextCursor(nextCursor)
    }).catch(e => {
      console.error(e); setDrafts([])
    })
  }
  useEffect(() => { load() }, [tab])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const { items, nextCursor: nc } = await api.admin.listDrafts(tab, { cursor: nextCursor })
      setDrafts(prev => [...(prev ?? []), ...items])
      setNextCursor(nc)
    } catch (e) {
      toast.error(e.message)
    } finally { setLoadingMore(false) }
  }

  const runIngest = async () => {
    setBusy(true); setIngestResult(null)
    try {
      const r = await api.admin.ingest()
      setIngestResult(r)
      load()
      const newItems = r.ingest?.newItems ?? 0
      const drafts = r.draft?.draftsCreated ?? 0
      const autoRejected = r.draft?.autoRejected ?? 0
      if (newItems === 0 && drafts === 0 && autoRejected === 0) {
        toast.info('Ingest finished — nothing new since the last run.')
      } else {
        const tail = autoRejected > 0 ? ` (${autoRejected} auto-rejected as low-confidence)` : ''
        toast.success({ title: 'Ingest finished', body: `${newItems} new article${newItems === 1 ? '' : 's'}, ${drafts} draft${drafts === 1 ? '' : 's'} ready to triage${tail}.` })
      }
    } catch (e) {
      toast.error({ title: 'Ingest failed', body: e.message })
    } finally { setBusy(false) }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelected(new Set((drafts ?? []).map(d => d.id)))
  const clearSelection = () => setSelected(new Set())

  const bulkReject = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`Reject ${ids.length} draft${ids.length > 1 ? 's' : ''}?`)) return
    setBusy(true)
    try {
      const r = await api.admin.bulkReject(ids)
      clearSelection()
      load()
      toast.success(`Rejected ${r.rejected} draft${r.rejected === 1 ? '' : 's'}.`)
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Draft queue</h1>
        <p className="text-sm text-muted">
          AI-generated market proposals from the news pipeline. Edit, then approve to go live.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap rounded-2xl bg-surface border border-border p-3">
        <div className="flex rounded-lg bg-surface2 border border-border overflow-hidden">
          {['PENDING', 'APPROVED', 'REJECTED'].map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); clearSelection() }}
              className={`text-xs px-3 py-1.5 ${tab === t ? 'bg-accent text-white font-semibold' : 'text-muted hover:text-text'}`}
            >
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'PENDING' && selected.size > 0 && (
          <>
            <span className="text-xs text-muted font-mono">{selected.size} selected</span>
            <button
              onClick={bulkReject}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-no/20 text-no border border-no/40 text-xs font-semibold hover:bg-no/30 disabled:opacity-50"
            >
              Bulk reject
            </button>
            <button onClick={clearSelection} className="text-xs text-muted hover:text-text px-2">Clear</button>
          </>
        )}
        {tab === 'PENDING' && drafts && drafts.length > 0 && selected.size === 0 && (
          <button onClick={selectAll} className="text-xs text-muted hover:text-text px-2">Select all</button>
        )}
        <button
          onClick={runIngest}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 size={12} strokeWidth={2.5} className="animate-spin" aria-hidden="true" />}
          {busy ? 'Running…' : 'Run ingest now'}
        </button>
      </div>

      {busy && <IngestProgress />}
      {ingestResult && !busy && <IngestResult result={ingestResult} />}

      {drafts === null ? (
        <div className="skeleton h-40 rounded-2xl" />
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl bg-surface/40 border border-dashed border-border py-16 text-center text-muted">
          {tab === 'PENDING' ? (
            <CheckCircle2 size={36} strokeWidth={1.25} className="mx-auto mb-3 text-yes/80" aria-hidden="true" />
          ) : (
            <Inbox size={36} strokeWidth={1.25} className="mx-auto mb-3 text-muted/70" aria-hidden="true" />
          )}
          <div className="text-sm">
            {tab === 'PENDING' ? 'Inbox zero — no drafts to triage.' : `No ${tab.toLowerCase()} drafts.`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map(d => (
            <DraftCard
              key={d.id}
              draft={d}
              editable={tab === 'PENDING'}
              selected={selected.has(d.id)}
              onToggleSelect={() => toggleSelect(d.id)}
              onApproved={(marketId) => nav(`/market/${marketId}`)}
              onChanged={load}
            />
          ))}
          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-3 rounded-2xl bg-surface border border-border text-sm font-semibold text-muted hover:text-text hover:border-accent/40 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loadingMore && <Loader2 size={14} strokeWidth={2.25} className="animate-spin" aria-hidden="true" />}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
          {!nextCursor && drafts.length >= 25 && (
            <div className="text-center text-[11px] text-muted py-2">All caught up.</div>
          )}
        </div>
      )}
    </div>
  )
}

const IngestResult = ({ result }) => (
  <div className="rounded-xl bg-surface border border-border p-3 text-xs font-mono">
    <div className="text-muted mb-1.5 text-[10px] uppercase tracking-wide">Last ingest</div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <Kpi label="feeds" value={result.ingest?.feeds} />
      <Kpi label="fetched" value={result.ingest?.fetched} />
      <Kpi label="new news" value={result.ingest?.newItems} />
      <Kpi label="drafts" value={result.draft?.draftsCreated} />
      <Kpi label="auto-rej" value={result.draft?.autoRejected} />
    </div>
    {result.ingest?.errors?.length > 0 && (
      <div className="mt-2 text-no text-[11px] space-y-1">
        {result.ingest.errors.map((e, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <AlertTriangle size={11} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{e.feed}: {e.message}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)

// Indeterminate progress while ingest is running. The whole pipeline takes
// ~30s for ~25 items (Mistral throttle = 1 req/s) so a determinate bar
// would be misleading without server-side progress events.
function IngestProgress() {
  return (
    <div className="rounded-xl bg-surface border border-accent/30 px-4 py-3 animate-fade-in">
      <div className="flex items-center gap-2.5 text-xs">
        <Loader2 size={14} strokeWidth={2.25} className="text-accent animate-spin shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-semibold text-text">Fetching feeds &amp; drafting markets</div>
          <div className="text-[11px] text-muted mt-0.5">
            This usually takes ~30s. Mistral throttles to 1 req/sec, so we're queueing news items one at a time.
          </div>
        </div>
      </div>
      <div className="mt-2.5 h-1 rounded-full bg-surface2 overflow-hidden">
        <div className="indeterminate-bar" />
      </div>
    </div>
  )
}

const Kpi = ({ label, value }) => (
  <div>
    <div className="text-[9px] uppercase text-muted">{label}</div>
    <div className="text-base font-bold">{value ?? '—'}</div>
  </div>
)

function DraftCard({ draft, editable, selected, onToggleSelect, onApproved, onChanged }) {
  const toast = useToast()
  // Local edit buffer; only flushes to the server on approve.
  const [form, setForm] = useState({
    description: draft.description,
    category: draft.category,
    outcomes: Array.isArray(draft.outcomes) ? draft.outcomes.join(', ') : '',
    days: Math.max(1, Math.round((new Date(draft.endTime) - Date.now()) / 86400000)),
    resolutionSource: draft.resolutionSource ?? '',
  })
  const [saving, setSaving] = useState(false)

  const approve = async () => {
    const outcomes = form.outcomes.split(',').map(s => s.trim()).filter(Boolean)
    if (outcomes.length < 2) { toast.error('Need at least 2 outcomes'); return }
    setSaving(true)
    try {
      const { marketId } = await api.admin.approveDraft(draft.id, {
        description: form.description,
        category: form.category,
        outcomes,
        endTime: Date.now() + Number(form.days) * 86400000,
        resolutionSource: form.resolutionSource,
      })
      toast.success(`Market #${marketId} is live.`)
      onApproved(marketId)
    } catch (e) { toast.error(e.message); setSaving(false) }
  }
  const reject = async () => {
    if (!confirm('Reject this draft?')) return
    setSaving(true)
    try {
      await api.admin.rejectDraft(draft.id)
      toast.info('Draft rejected.')
      onChanged()
    } catch (e) { toast.error(e.message); setSaving(false) }
  }

  const statusBadge = useMemo(() => {
    const map = {
      PENDING: 'bg-amber-500/20 text-amber-300',
      APPROVED: 'bg-yes/20 text-yes',
      REJECTED: 'bg-no/20 text-no',
    }
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${map[draft.status]}`}>{draft.status}</span>
  }, [draft.status])

  return (
    <div className={`rounded-2xl bg-surface border p-4 space-y-3 ${selected ? 'border-accent/60 bg-accent/5' : 'border-border'}`}>
      <div className="flex items-start gap-3">
        {editable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 accent-accent"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {statusBadge}
            {draft.confidence != null && (
              <span className="text-[10px] text-muted font-mono">conf {(draft.confidence * 100).toFixed(0)}%</span>
            )}
            {draft.newsItem && (
              <a
                href={draft.newsItem.url} target="_blank" rel="noreferrer"
                className="text-[10px] text-muted hover:text-accent truncate max-w-[60ch] inline-flex items-center gap-1"
                title={draft.newsItem.title}
              >
                <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{draft.newsItem.source} — {draft.newsItem.title}</span>
              </a>
            )}
          </div>
          {editable ? (
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
            />
          ) : (
            <div className="text-sm font-medium">{draft.description}</div>
          )}
          {draft.rationale && (
            <div className="text-[11px] text-muted mt-1.5 italic">{draft.rationale}</div>
          )}
        </div>
      </div>

      {editable && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <FieldInline label="Category">
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              className="w-full bg-surface2 border border-border rounded px-2 py-1"
            >
              {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
            </select>
          </FieldInline>
          <FieldInline label="Days to close">
            <input
              type="number" min="1" max="365"
              value={form.days}
              onChange={e => setForm({ ...form, days: e.target.value })}
              className="w-full bg-surface2 border border-border rounded px-2 py-1"
            />
          </FieldInline>
          <FieldInline label="Outcomes (comma-sep)" wide>
            <input
              value={form.outcomes}
              onChange={e => setForm({ ...form, outcomes: e.target.value })}
              className="w-full bg-surface2 border border-border rounded px-2 py-1"
            />
          </FieldInline>
        </div>
      )}

      {editable && (
        <FieldInline label="Resolution source" wide>
          <input
            value={form.resolutionSource}
            onChange={e => setForm({ ...form, resolutionSource: e.target.value })}
            className="w-full bg-surface2 border border-border rounded px-2 py-1 text-xs"
          />
        </FieldInline>
      )}

      {!editable && draft.approvedMarketId && (
        <div className="text-[11px] text-muted">
          Approved → <a href={`/market/${draft.approvedMarketId}`} className="text-accent hover:underline">Market #{draft.approvedMarketId}</a>
          {draft.reviewedByHandle && <span> by {draft.reviewedByHandle}</span>}
        </div>
      )}

      {editable && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={reject}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-no/20 text-no border border-no/40 text-xs font-semibold hover:bg-no/30 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={approve}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-yes/20 text-yes border border-yes/40 text-xs font-semibold hover:bg-yes/30 disabled:opacity-50"
          >
            {saving ? (
              'Saving…'
            ) : (
              <span className="inline-flex items-center gap-1.5">Approve <ArrowRight size={12} strokeWidth={2.25} aria-hidden="true" /></span>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

const FieldInline = ({ label, wide, children }) => (
  <label className={`block ${wide ? 'col-span-2 sm:col-span-4' : ''}`}>
    <div className="text-[10px] text-muted mb-0.5 uppercase tracking-wide">{label}</div>
    {children}
  </label>
)
