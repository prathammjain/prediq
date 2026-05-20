// RSS feeds we ingest from. Curated for stability — these publishers have
// well-formed RSS 2.0 / Atom feeds that have been reliable for years.
//
// To add a feed: append { name, url, category, type? }. `type` is optional
// and just hints to the parser; it auto-detects RSS vs Atom from the root tag.
//
// `category` becomes the default Market.category for drafts seeded from this
// feed (the draft generator can override it).

const FEEDS = [
  {
    name: 'BBC News — World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'Politics',
  },
  {
    name: 'BBC News — India',
    url: 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml',
    category: 'Politics',
  },
  {
    name: 'The Hindu — National',
    url: 'https://www.thehindu.com/news/national/feeder/default.rss',
    category: 'Politics',
  },
  {
    name: 'ESPN Cricinfo',
    url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
    category: 'Cricket',
  },
]

module.exports = { FEEDS }
