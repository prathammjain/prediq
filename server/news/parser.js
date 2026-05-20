// RSS 2.0 / Atom parser. Wraps fast-xml-parser with a small adapter that
// returns a uniform shape regardless of feed format:
//
//   { source, items: [{ url, title, summary, publishedAt }] }
//
// Handles:
//   • RSS 2.0  (<rss><channel><item>…)
//   • Atom 1.0 (<feed><entry>…) — link is `<link href="…"/>`, body is
//     `<summary>` or `<content>`, time is `<published>` or `<updated>`.
//
// Edge cases:
//   • Item with no <link> is dropped (we need a stable URL for dedup).
//   • Date parsing falls back to undefined if the source date is malformed
//     — better to let DB store null than to fabricate a fetchedAt-equivalent.

const { XMLParser } = require('fast-xml-parser')

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Many feeds wrap text in CDATA; fast-xml-parser strips it for us by default.
  trimValues: true,
})

function asArray(x) {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

// Atom <link> can be `{"@href": "..."}` or `[{...}, {...}]` (multiple rels).
function pickAtomLink(link) {
  for (const l of asArray(link)) {
    if (typeof l === 'string') return l
    if (l && l['@href'] && (!l['@rel'] || l['@rel'] === 'alternate')) return l['@href']
  }
  return null
}

function parseDate(s) {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t) : null
}

// Strip HTML tags from a description / summary. We don't render the body
// itself anywhere — only feed it to the draft generator and show a short
// preview to the admin — so plain text is fine.
function stripHtml(s) {
  if (!s) return null
  // fast-xml-parser may return an object like { '@type': 'html', '#text': '…' }
  // when the source element has attributes; reach into #text in that case.
  const text = typeof s === 'object' ? (s['#text'] ?? '') : s
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
}

function parseFeed(xml) {
  const doc = parser.parse(xml)

  // RSS 2.0
  if (doc.rss?.channel) {
    const ch = doc.rss.channel
    const items = asArray(ch.item).map(it => ({
      url: typeof it.link === 'string' ? it.link : (it.link?.['@href'] ?? null),
      title: typeof it.title === 'string' ? it.title : (it.title?.['#text'] ?? ''),
      summary: stripHtml(it.description ?? it['content:encoded']),
      publishedAt: parseDate(it.pubDate ?? it['dc:date']),
    })).filter(x => x.url && x.title)
    return { items, channelTitle: typeof ch.title === 'string' ? ch.title : null }
  }

  // Atom 1.0
  if (doc.feed?.entry) {
    const entries = asArray(doc.feed.entry).map(e => ({
      url: pickAtomLink(e.link),
      title: typeof e.title === 'string' ? e.title : (e.title?.['#text'] ?? ''),
      summary: stripHtml(e.summary ?? e.content),
      publishedAt: parseDate(e.published ?? e.updated),
    })).filter(x => x.url && x.title)
    return { items: entries, channelTitle: typeof doc.feed.title === 'string' ? doc.feed.title : null }
  }

  return { items: [], channelTitle: null }
}

module.exports = { parseFeed }
