// Unit test for draftPending's confidence-threshold gating.
//
// Mocks mistral.chat so we control what proposals come back, and uses
// a hand-rolled prisma stub so we can assert on what gets written.

jest.mock('../server/news/mistral', () => ({
  chat: jest.fn(),
  MistralError: class MistralError extends Error {},
}))

const { chat } = require('../server/news/mistral')
const { draftPending } = require('../server/news/draft')

function makePrisma(newsItems) {
  const creates = []
  const updates = []
  return {
    creates,
    updates,
    newsItem: {
      findMany: jest.fn().mockResolvedValue(newsItems),
      update: jest.fn(async ({ where, data }) => {
        updates.push({ where, data })
        return { id: where.id, ...data }
      }),
    },
    marketDraft: {
      create: jest.fn(async ({ data }) => {
        creates.push(data)
        return { id: creates.length, ...data }
      }),
    },
  }
}

const fakeItem = (id) => ({
  id,
  source: 'TestSource',
  title: `Title ${id}`,
  summary: 'summary',
  url: `https://example.com/${id}`,
})

const proposalShape = (confidence) => ({
  description: 'Will X happen by date?',
  outcomes: ['Yes', 'No'],
  category: 'Other',
  daysUntilClose: 7,
  resolutionSource: 'https://example.com/source',
  rationale: 'because',
  confidence,
})

describe('draftPending — confidence threshold', () => {
  beforeEach(() => {
    chat.mockReset()
    delete process.env.NEWS_DRAFT_MIN_CONFIDENCE
  })

  test('auto-rejects drafts below the default 0.7 threshold', async () => {
    chat.mockResolvedValue({
      content: { drafts: [proposalShape(0.5)] },
      usage: null,
    })
    const prisma = makePrisma([fakeItem(1)])

    const result = await draftPending(prisma)

    expect(result).toEqual(expect.objectContaining({
      processed: 1,
      draftsCreated: 0,
      autoRejected: 1,
    }))
    expect(prisma.creates).toHaveLength(1)
    expect(prisma.creates[0]).toEqual(expect.objectContaining({
      status: 'REJECTED',
      reviewedByHandle: 'auto',
      confidence: 0.5,
    }))
    expect(prisma.creates[0].reviewedAt).toBeInstanceOf(Date)
  })

  test('keeps high-confidence drafts as PENDING (no status override)', async () => {
    chat.mockResolvedValue({
      content: { drafts: [proposalShape(0.9)] },
      usage: null,
    })
    const prisma = makePrisma([fakeItem(2)])

    const result = await draftPending(prisma)

    expect(result.draftsCreated).toBe(1)
    expect(result.autoRejected).toBe(0)
    // status not set → defaults to PENDING at the DB level
    expect(prisma.creates[0].status).toBeUndefined()
    expect(prisma.creates[0].reviewedByHandle).toBeUndefined()
  })

  test('leaves null-confidence drafts as PENDING (no silent drop)', async () => {
    chat.mockResolvedValue({
      content: { drafts: [proposalShape(null)] },
      usage: null,
    })
    const prisma = makePrisma([fakeItem(3)])

    const result = await draftPending(prisma)

    expect(result.draftsCreated).toBe(1)
    expect(result.autoRejected).toBe(0)
    expect(prisma.creates[0].status).toBeUndefined()
  })

  test('respects NEWS_DRAFT_MIN_CONFIDENCE override', async () => {
    process.env.NEWS_DRAFT_MIN_CONFIDENCE = '0.9'
    chat.mockResolvedValue({
      content: { drafts: [proposalShape(0.8)] },
      usage: null,
    })
    const prisma = makePrisma([fakeItem(4)])

    const result = await draftPending(prisma)

    expect(result.autoRejected).toBe(1)
    expect(prisma.creates[0].status).toBe('REJECTED')
  })

  test('threshold is strict less-than: exactly-at-threshold passes', async () => {
    chat.mockResolvedValue({
      content: { drafts: [proposalShape(0.7)] },
      usage: null,
    })
    const prisma = makePrisma([fakeItem(5)])

    const result = await draftPending(prisma)

    expect(result.draftsCreated).toBe(1)
    expect(result.autoRejected).toBe(0)
  })
})
