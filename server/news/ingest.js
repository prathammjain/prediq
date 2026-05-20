// ingest.js — pull configured RSS feeds, parse, dedupe, persist.
//
// Each call returns an object describing the work done:
//   { feeds: N, fetched: N, newItems: N, errors: [{feed, message}] }
//
// Idempotent: the (url) unique constraint on NewsItem means re-ingesting
// the same feed is a no-op for already-seen URLs.

const { FEEDS } = require('./feeds')
const { parseFeed } = require('./parser')

const FETCH_TIMEOUT_MS = 12_000
const USER_AGENT = 'predIQ/0.2 (+rss ingest)'

async function fetchFeed(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

async function ingestOne(prisma, feed) {
  const xml = await fetchFeed(feed.url)
  const { items } = parseFeed(xml)
  let newItems = 0
  for (const it of items) {
    // upsert: insert if new, no-op if URL already seen.
    const existing = await prisma.newsItem.findUnique({ where: { url: it.url } })
    if (existing) continue
    await prisma.newsItem.create({
      data: {
        url: it.url,
        title: it.title.slice(0, 500),
        summary: it.summary?.slice(0, 2000) ?? null,
        source: feed.name,
        publishedAt: it.publishedAt,
      },
    })
    newItems += 1
  }
  return { feed: feed.name, fetched: items.length, newItems }
}

async function ingestAll(prisma, { feeds = FEEDS } = {}) {
  const results = []
  const errors = []
  // Fetch sequentially. Could be Promise.all but we don't want a thundering
  // herd on cold-start, and ingest is admin-triggered so latency is fine.
  for (const f of feeds) {
    try {
      results.push(await ingestOne(prisma, f))
    } catch (e) {
      errors.push({ feed: f.name, message: e.message ?? String(e) })
    }
  }
  return {
    feeds: feeds.length,
    fetched: results.reduce((a, r) => a + r.fetched, 0),
    newItems: results.reduce((a, r) => a + r.newItems, 0),
    perFeed: results,
    errors,
  }
}

module.exports = { ingestAll, ingestOne, fetchFeed }
