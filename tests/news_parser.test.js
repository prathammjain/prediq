const { parseFeed } = require('../server/news/parser')

const RSS_2_0 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example News</title>
    <link>https://example.com</link>
    <description>Top stories</description>
    <item>
      <title>Election results announced</title>
      <link>https://example.com/article-1</link>
      <description><![CDATA[<p>The <b>results</b> are in.</p>]]></description>
      <pubDate>Tue, 06 May 2026 04:30:00 GMT</pubDate>
      <guid>https://example.com/article-1</guid>
    </item>
    <item>
      <title>Cricket: India beat Australia</title>
      <link>https://example.com/article-2</link>
      <description>India won by 7 wickets.</description>
      <pubDate>Tue, 06 May 2026 02:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Item with no link</title>
      <description>Should be filtered out.</description>
    </item>
  </channel>
</rss>`

const ATOM_1_0 = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <link href="https://example.com/atom" />
  <updated>2026-05-06T04:30:00Z</updated>
  <entry>
    <title>RBI holds rates</title>
    <link href="https://example.com/atom-1" rel="alternate"/>
    <link href="https://example.com/atom-1.json" rel="self"/>
    <summary>Repo rate unchanged at 6.5%.</summary>
    <published>2026-05-06T04:30:00Z</published>
  </entry>
  <entry>
    <title>Market analysis</title>
    <link href="https://example.com/atom-2"/>
    <content type="html">&lt;p&gt;Nifty up 0.8%.&lt;/p&gt;</content>
    <updated>2026-05-06T05:00:00Z</updated>
  </entry>
</feed>`

describe('RSS 2.0 parser', () => {
  const { items } = parseFeed(RSS_2_0)

  test('drops items with no link', () => {
    expect(items.length).toBe(2)
    expect(items.every(x => x.url)).toBe(true)
  })

  test('extracts title, url, summary, publishedAt', () => {
    const a = items[0]
    expect(a.title).toBe('Election results announced')
    expect(a.url).toBe('https://example.com/article-1')
    expect(a.summary).toBe('The results are in.')
    expect(a.publishedAt).toBeInstanceOf(Date)
    expect(a.publishedAt.toISOString()).toBe('2026-05-06T04:30:00.000Z')
  })

  test('strips HTML tags from CDATA-wrapped descriptions', () => {
    expect(items[0].summary).not.toMatch(/<|>/)
  })
})

describe('Atom 1.0 parser', () => {
  const { items } = parseFeed(ATOM_1_0)

  test('extracts entries', () => {
    expect(items.length).toBe(2)
  })

  test('picks the alternate link, not self/json', () => {
    expect(items[0].url).toBe('https://example.com/atom-1')
  })

  test('falls back to <updated> when no <published>', () => {
    expect(items[1].publishedAt.toISOString()).toBe('2026-05-06T05:00:00.000Z')
  })

  test('strips HTML from <content>', () => {
    expect(items[1].summary).toBe('Nifty up 0.8%.')
  })
})

describe('parseFeed edge cases', () => {
  test('returns empty items on garbage input', () => {
    const { items } = parseFeed('<not-a-feed/>')
    expect(items).toEqual([])
  })

  test('handles a single-item feed (XML parser may not return an array)', () => {
    const xml = `<rss version="2.0"><channel>
      <item><title>Solo</title><link>https://example.com/solo</link></item>
    </channel></rss>`
    const { items } = parseFeed(xml)
    expect(items.length).toBe(1)
    expect(items[0].title).toBe('Solo')
  })
})
