#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const svc = require('./marketService')

const server = new McpServer({
  name: 'predIQ MCP Server',
  version: '0.2.0',
})

server.tool(
  'list_markets',
  'List prediction markets with optional filters',
  {
    category: z.string().optional().describe('Filter by category (e.g. Cricket, Economy, Markets, Science)'),
    sort: z.enum(['new', 'trending', 'ending']).optional().describe('Sort order'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
  },
  async ({ category, sort, limit }) => {
    const markets = await svc.listMarkets({ category, sort, limit })
    return { content: [{ type: 'text', text: JSON.stringify(markets, null, 2) }] }
  }
)

server.tool(
  'get_market',
  'Get full details of a single prediction market including price history',
  { id: z.number().int().positive() },
  async ({ id }) => {
    const market = await svc.getMarket(id)
    if (!market) return { content: [{ type: 'text', text: 'Market not found' }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(market, null, 2) }] }
  }
)

server.tool(
  'get_user_stats',
  'Get a user scoring report with PAS rating, accuracy, Brier score, streaks',
  { handle: z.string().describe('User handle') },
  async ({ handle }) => {
    const report = await svc.getScoringReport(handle)
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
  }
)

server.tool(
  'get_leaderboard',
  'Get leaderboard rankings sorted by balance, PAS rating, PnL, or streak',
  {
    by: z.enum(['balance', 'pas', 'pnl', 'streak']).optional().describe('Sort dimension'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of users'),
  },
  async ({ by, limit }) => {
    const board = await svc.getLeaderboard({ by, limit })
    return { content: [{ type: 'text', text: JSON.stringify(board, null, 2) }] }
  }
)

server.tool(
  'get_user_positions',
  'Get all share positions for a user with mark-to-market values',
  { handle: z.string().describe('User handle') },
  async ({ handle }) => {
    const positions = await svc.getPositions(handle)
    return { content: [{ type: 'text', text: JSON.stringify(positions, null, 2) }] }
  }
)

server.tool(
  'get_user_calibration',
  'Get calibration report with reliability diagram data, ECE, MCE for a user',
  {
    handle: z.string(),
    bins: z.number().int().min(3).max(20).optional().describe('Number of probability bins (default 10)'),
  },
  async ({ handle, bins }) => {
    const report = await svc.getCalibrationReport(handle, bins)
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
  }
)

server.tool(
  'get_user_badges',
  'Get earned and available badges for a user',
  { handle: z.string() },
  async ({ handle }) => {
    const badges = await svc.getBadges(handle)
    return { content: [{ type: 'text', text: JSON.stringify(badges, null, 2) }] }
  }
)

server.tool(
  'get_user_transactions',
  'Get recent coin transaction history for a user',
  {
    handle: z.string(),
    limit: z.number().int().min(1).max(100).optional().describe('Number of transactions (default 50)'),
  },
  async ({ handle, limit }) => {
    const txs = await svc.getTransactions(handle, limit)
    return { content: [{ type: 'text', text: JSON.stringify(txs, null, 2) }] }
  }
)

server.tool(
  'buy_shares',
  'Buy shares of an outcome in a prediction market. Returns shares bought, fill price, new balance.',
  {
    userHandle: z.string().describe('Your user handle'),
    marketId: z.number().int().positive(),
    outcomeIndex: z.number().int().min(0).describe('Index of the outcome to buy (0=first, 1=second, etc.)'),
    chips: z.number().positive().describe('Amount of chips to spend'),
  },
  async ({ userHandle, marketId, outcomeIndex, chips }) => {
    try {
      const result = await svc.tradeBuy({ userHandle, marketId, outcomeIndex, chips })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Trade failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'sell_shares',
  'Sell shares back to the market. Returns refund amount and new balance.',
  {
    userHandle: z.string(),
    marketId: z.number().int().positive(),
    outcomeIndex: z.number().int().min(0),
    shares: z.number().positive().describe('Number of shares to sell'),
  },
  async ({ userHandle, marketId, outcomeIndex, shares }) => {
    try {
      const result = await svc.tradeSell({ userHandle, marketId, outcomeIndex, shares })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Sell failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'preview_trade',
  'Preview what a trade would look like without executing it',
  {
    marketId: z.number().int().positive(),
    outcomeIndex: z.number().int().min(0),
    chips: z.number().positive(),
  },
  async ({ marketId, outcomeIndex, chips }) => {
    try {
      const result = await svc.previewTrade({ marketId, outcomeIndex, chips })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Preview failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'preview_sell',
  'Preview what a sell would return without executing it',
  {
    marketId: z.number().int().positive(),
    outcomeIndex: z.number().int().min(0),
    shares: z.number().positive(),
  },
  async ({ marketId, outcomeIndex, shares }) => {
    try {
      const result = await svc.previewSell({ marketId, outcomeIndex, shares })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Preview failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'create_market',
  'Create a new prediction market',
  {
    description: z.string().min(1).describe('The question the market asks'),
    endTime: z.number().positive().describe('Unix timestamp (ms) when trading ends'),
    ownerHandle: z.string().describe('Handle of the market creator'),
    outcomes: z.array(z.string()).min(2).describe('Array of outcome names (at least 2)'),
    category: z.string().optional().describe('Category (Cricket, Economy, Markets, Science, etc.)'),
    resolutionSource: z.string().optional().describe('Where the official result will be published'),
    liquidityB: z.number().positive().optional().describe('Liquidity parameter (default 500)'),
    useLsLmsr: z.boolean().optional().describe('Use liquidity-sensitive LMSR'),
    lsAlpha: z.number().positive().optional().describe('LS-LMSR alpha parameter'),
  },
  async (params) => {
    try {
      const marketId = await svc.createMarket(params)
      return { content: [{ type: 'text', text: JSON.stringify({ marketId }, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Create market failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'claim_payout',
  'Claim winnings from a resolved market where you hold the winning outcome',
  {
    userHandle: z.string(),
    marketId: z.number().int().positive(),
  },
  async ({ userHandle, marketId }) => {
    try {
      const result = await svc.claimPayout({ userHandle, marketId })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Claim failed: ${e.message}` }], isError: true }
    }
  }
)

server.tool(
  'get_lifecycle_actions',
  'Get pending actions for a user: claimable payouts, markets needing proposals, open disputes',
  { userHandle: z.string() },
  async ({ userHandle }) => {
    const actions = await svc.getLifecycleActions(userHandle)
    return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
  }
)

server.tool(
  'get_user_balance',
  'Get a user current chip balance',
  { userHandle: z.string() },
  async ({ userHandle }) => {
    const balance = await svc.getBalance(userHandle)
    return { content: [{ type: 'text', text: JSON.stringify({ handle: userHandle, balance }, null, 2) }] }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('predIQ MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal MCP error:', err)
  process.exit(1)
})
