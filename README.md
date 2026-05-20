# predIQ

A prediction-market platform that scores **forecasting skill**, not luck. Trade
play chips on real-world events through a continuous-pricing market maker, and
get a verifiable rating for how good your predictions actually were.

predIQ is intentionally **off-chain**. The interesting math — LMSR pricing,
proper scoring rules, calibration analytics, the PAS skill rating — is what
makes the product valuable, and none of it is improved by sitting on a
blockchain. The chip economy is virtual; nothing here is gambling.

## What's here

| Layer            | Stack                                  | Purpose                                                                |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Pricing engine   | LMSR (Hanson 2003) in `server/lmsr.js` | Continuous prices, bounded subsidy, N-outcome support                  |
| Scoring          | Brier + log loss + PAS Elo             | Calibration framework + a Kelly-flavoured skill rating                 |
| Calibration      | Murphy decomposition, ECE, MCE         | Reliability diagrams that say "is this user actually well-calibrated?" |
| Persistence      | Prisma + SQLite (Postgres-ready)       | Append-only trade & chip ledger, full audit trail                      |
| Resolution       | Propose → 24h dispute → finalize       | Two-phase commit with admin override                                   |
| API              | Express                                | REST surface, ~15 endpoints                                            |
| Frontend         | Vite + React 18 + Tailwind             | Six pages, live sparklines, buy modal                                  |

## Quick start

```bash
# 1. Install
npm install
npm --prefix frontend-vite install

# 2. Initialise the database
npx prisma migrate deploy
npx prisma generate

# 3. Run the API (seeds 6 sample markets + 5 demo users on cold start)
npm start            # http://localhost:3000

# 4. In another terminal, run the dev frontend
npm run frontend:dev # http://localhost:5173
```

`.env` only needs `DATABASE_URL`. Default points at SQLite for local dev. For
production, swap the Prisma datasource to `postgresql` — no query changes
needed.

## How the scoring works

Two distinct frameworks live in `server/scoring.js`. Don't conflate them.

**Proper scoring rules (calibration).** A forecaster who reports a probability
*p* and observes outcome *y* is scored on `(y − p)²` (Brier) and `−log p`
(log loss). These are *minimised in expectation iff the forecaster reports
their true belief* — which is why we use them to ask: "when this user's trades
implied a 70% probability, did the event actually happen 70% of the time?"
That's calibration; `server/calibration.js` runs it through bins, ECE, MCE,
and the Murphy decomposition (`Brier = Reliability − Resolution + Uncertainty`).

**PAS — Prediction Accuracy Score.** LMSR users don't *report* probabilities,
they *trade*. Per-share PnL of a winning trade at price *p* is `(1 − p)`, and
of a losing one is `−p`. PAS rewards exactly that:

```
ΔPAS = K · (y − p) · sqrt(chips / TYPICAL_STAKE)
```

So buying YES at 20% and winning gives a big contrarian reward; buying YES at
80% and winning gives a small one; the stake-weight is sub-linear so a whale
can't bulldoze the leaderboard. PAS is symmetric: at the true probability the
expected ΔPAS is zero.

## How LMSR works here

Each market keeps a vector `q[]` of shares outstanding per outcome and a
liquidity parameter `b`. Prices are `p_i = exp(q_i / b) / Σ exp(q_j / b)` and
the cost of buying Δ shares of outcome *i* is `C(q + Δ·e_i) − C(q)` where
`C(q) = b · ln(Σ exp(q_j / b))`. We exponentiate after subtracting `max(q)/b`
for numerical stability. To go from "user wants to spend N chips" to "how
many shares?" we binary-search the cost function (it's monotone).

Worst-case subsidy — the most chips the market maker can lose — is bounded by
`b · ln(N)`. `server/adaptiveLiquidity.js` recommends `b` for new markets as
a function of expected volume; `b` is fixed for the lifetime of a given market
to avoid cost-curve discontinuities for existing positions. Moving to true
liquidity-sensitive LMSR (`b ≡ α · Σq`) is a future change in the same file.

## Resolution lifecycle

```
LIVE  ──propose──▶  PROPOSED  ──dispute──▶  DISPUTED  ──admin──▶  RESOLVED
                       │                                              ▲
                       └─── 24h dispute window expires ───────────────┘
```

When a market resolves, `gradeAllTrades` walks the trade ledger in
chronological order and writes per-trade Brier loss, log loss, and PAS delta
into the `Trade` row. User aggregates (PAS rating, mean Brier, accuracy,
streaks) update incrementally. The grading is **idempotent** — trades with
`graded = true` are skipped, so re-running on the same market is safe.

## API surface

```
GET    /api/markets                       list markets (?category=…)
GET    /api/markets/:id                   market detail + price history
POST   /api/markets                       create
POST   /api/markets/:id/preview           "if I spent N chips, what would I get?"
POST   /api/markets/:id/trade             buy shares (LMSR)
POST   /api/markets/:id/propose           propose resolution (creator)
POST   /api/markets/:id/dispute           flag during 24h window
POST   /api/markets/:id/finalize          lock outcome (after window or admin)
POST   /api/markets/:id/claim             claim winning payout

GET    /api/users/:user/balance
POST   /api/users/:user/bonus             daily login bonus
GET    /api/users/:user/positions
GET    /api/users/:user/scoring           PAS, Brier, log-loss, accuracy
GET    /api/users/:user/calibration       reliability bins + ECE + Murphy
GET    /api/users/:user/transactions      chip ledger
GET    /api/users/:user/badges
GET    /api/leaderboard                   ?by=balance|pas|pnl|streak
```

## Repository layout

```
server/                Express API + Prisma services
  index.js             routes
  marketService.js     trade lifecycle, resolution, grading, badges
  lmsr.js              cost / price / share-for-chips
  scoring.js           Brier, log loss, PAS
  calibration.js       binning, ECE, Murphy decomposition
  adaptiveLiquidity.js volume-aware b sizing

frontend-vite/         Vite + React 18 + Tailwind UI

prisma/
  schema.prisma        canonical schema
  migrations/          generated, committed

tests/                 Jest unit + API integration tests
```

## Tests

```bash
npm test               # unit + integration
npm run test:watch     # TDD loop
```

The math in `lmsr`, `scoring`, `calibration`, and `adaptiveLiquidity` is fully
unit-tested. `tests/api.test.js` covers the trade → propose → finalize → claim
→ grade flow end-to-end against an in-memory SQLite DB, asserting ledger
invariants (`Σ ledger amounts == chipsBalance`) and that PAS deltas land
within tolerance.

## License

MIT.
