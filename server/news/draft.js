// draft.js — generate MarketDraft proposals from un-drafted NewsItems
// using Mistral's chat completions API in JSON mode.
//
// The model is asked to return zero or more drafts per news item — many
// stories don't lend themselves to a clean prediction market and forcing
// drafts in those cases would just create admin work. Each draft is shape-
// validated before persistence; malformed entries are dropped.
//
// Per-item errors are isolated: a Mistral failure on one item does NOT
// mark it as `drafted`, so the next ingest will retry it. A successful
// run with zero drafts DOES mark it (the model judged it un-marketable).

const { chat, MistralError } = require('./mistral')

const ALLOWED_CATEGORIES = new Set([
  'Cricket', 'Football', 'Politics', 'Economy', 'Markets',
  'Entertainment', 'Science', 'Geopolitics', 'Other',
])

// We rebuild the system prompt per-call so today's date is always fresh.
// Without this, the model has used training-cutoff dates and minted
// already-past resolution windows in the description text.
function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  return SYSTEM_PROMPT_TEMPLATE.replace('{TODAY}', today)
}

const SYSTEM_PROMPT_TEMPLATE = `You are an editor for a prediction-market platform. Today is {TODAY}. Every market you propose MUST resolve strictly AFTER {TODAY}; never reference dates that are already in the past.

Given a single news article (title and summary), propose 0–3 short, *resolvable* prediction markets seeded by that article.

A good market:
- Has a clear, objectively-verifiable resolution criterion.
- Resolves on a definite future date or event (within 1–365 days).
- Has 2–6 mutually exclusive outcomes that cover the space.
- Cites a specific resolution source (an official site, regulator, score, or tally).

A bad market (return zero drafts):
- Asks for opinions, vibes, or already-known facts.
- Is conditional on something that hasn't happened (e.g. "if X happens, will Y…").
- Cannot be resolved by a single source you can name.

Output strictly the following JSON shape:

{
  "drafts": [
    {
      "description": "Short question, 80 chars max, ends with a question mark.",
      "outcomes": ["Yes", "No"],          // 2..6 strings
      "category": "one of: Cricket, Football, Politics, Economy, Markets, Entertainment, Science, Geopolitics, Other",
      "daysUntilClose": 7,                 // integer 1..365
      "resolutionSource": "Specific URL, regulator, or scoreboard. NOT just 'news reports'.",
      "rationale": "1 sentence on why this is resolvable.",
      "confidence": 0.0                    // 0..1, your confidence the market is well-formed
    }
  ]
}

Return {"drafts": []} when nothing fits. Do not invent facts beyond the article.`

function buildUserMessage(news) {
  return `Source: ${news.source}
Title: ${news.title}
Summary: ${news.summary ?? '(no summary provided)'}
URL: ${news.url}`
}

// Validate a single proposal. Returns the cleaned object or null if invalid.
function sanitizeProposal(p, fallbackUrl) {
  if (!p || typeof p !== 'object') return null
  const description = typeof p.description === 'string' ? p.description.trim() : ''
  if (description.length < 8 || description.length > 280) return null

  const outcomes = Array.isArray(p.outcomes) ? p.outcomes.map(o => String(o).trim()).filter(Boolean) : []
  if (outcomes.length < 2 || outcomes.length > 6) return null

  const category = ALLOWED_CATEGORIES.has(p.category) ? p.category : 'Other'

  const days = Number(p.daysUntilClose)
  if (!Number.isFinite(days) || days < 1 || days > 365) return null

  const resolutionSource = typeof p.resolutionSource === 'string' && p.resolutionSource.trim()
    ? p.resolutionSource.trim().slice(0, 500)
    : fallbackUrl

  const rationale = typeof p.rationale === 'string' ? p.rationale.trim().slice(0, 500) : null
  // p.confidence absent → null (NOT 0). Number(null) is 0, so we must guard
  // before coercion or the threshold check would auto-reject every proposal
  // where the model simply omitted the field.
  const confidence = (p.confidence == null || !Number.isFinite(Number(p.confidence)))
    ? null
    : Math.max(0, Math.min(1, Number(p.confidence)))

  return {
    description,
    outcomes,
    category,
    endTimeOffsetMs: days * 24 * 60 * 60 * 1000,
    resolutionSource,
    rationale,
    confidence,
  }
}

async function generateDraftsFor(newsItem) {
  const { content, usage } = await chat({
    system: systemPrompt(),
    user: buildUserMessage(newsItem),
    jsonMode: true,
    temperature: 0.4,
    maxTokens: 800,
  })

  const drafts = Array.isArray(content?.drafts) ? content.drafts : []
  const cleaned = drafts.map(d => sanitizeProposal(d, newsItem.url)).filter(Boolean)

  // Lightweight observability — token usage per item, helpful while tuning
  // the prompt. Only logs when usage is present.
  if (usage) {
    console.log(`[draft] news=${newsItem.id} drafts=${cleaned.length} tokens=${usage.total_tokens}`)
  }
  return cleaned
}

// Mistral free tier is 1 request/second. With sequential awaits + a small
// guard delay we stay comfortably under the limit.
const MIN_GAP_MS = 1100

// Drafts with confidence below this threshold are auto-rejected on save
// (status=REJECTED, reviewedByHandle='auto') so they never clutter the
// PENDING queue. Null confidence is left as PENDING — the model sometimes
// omits the field and we don't want to silently drop legit proposals.
function minConfidence() {
  const raw = Number(process.env.NEWS_DRAFT_MIN_CONFIDENCE)
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.7
}

async function draftPending(prisma, { limit = 25 } = {}) {
  const pending = await prisma.newsItem.findMany({
    where: { drafted: false },
    orderBy: { fetchedAt: 'asc' },
    take: limit,
  })

  const threshold = minConfidence()
  let created = 0
  let autoRejected = 0
  const errors = []
  let lastCallAt = 0

  for (const item of pending) {
    // Throttle to ≤ 1 req/sec.
    const wait = lastCallAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastCallAt = Date.now()

    let proposals
    try {
      proposals = await generateDraftsFor(item)
    } catch (e) {
      const msg = e instanceof MistralError ? `${e.message} (${e.status ?? '—'})` : (e.message ?? String(e))
      console.error(`[draft] news=${item.id} failed: ${msg}`)
      errors.push({ newsItemId: item.id, message: msg })
      // Do NOT mark as drafted — next ingest will retry.
      continue
    }

    for (const p of proposals) {
      const lowConf = p.confidence != null && p.confidence < threshold
      await prisma.marketDraft.create({
        data: {
          description: p.description,
          category: p.category,
          outcomes: JSON.stringify(p.outcomes),
          endTime: new Date(Date.now() + p.endTimeOffsetMs),
          resolutionSource: p.resolutionSource,
          liquidityB: 500,
          useLsLmsr: false,
          lsAlpha: 0.05,
          rationale: p.rationale,
          confidence: p.confidence,
          newsItemId: item.id,
          ...(lowConf && {
            status: 'REJECTED',
            reviewedAt: new Date(),
            reviewedByHandle: 'auto',
          }),
        },
      })
      if (lowConf) autoRejected += 1
      else created += 1
    }

    // Successful run (even with zero drafts) means we processed this item.
    await prisma.newsItem.update({
      where: { id: item.id },
      data: { drafted: true },
    })
  }

  return { processed: pending.length, draftsCreated: created, autoRejected, errors }
}

module.exports = { generateDraftsFor, draftPending }
