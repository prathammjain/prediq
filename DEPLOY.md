# Deploying predIQ

predIQ ships as a single Node 20 container. The frontend is built once at
image-build time and served as static assets by the same Express process.
Postgres is the production DB; SQLite is dev-only.

## Local production-like (Docker Compose)

The fastest way to mirror production on your laptop:

```bash
cp .env.example .env
# edit .env — at minimum set MISTRAL_API_KEY if you want the news pipeline
docker compose up --build
```

This brings up:

- `postgres` — Postgres 16 with a named volume (`postgres-data`)
- `web` — the predIQ image, port `3000:3000`

The web container runs `prisma db push --skip-generate` on every start —
idempotent, no migration history needed for first-time deploy. Once you
have proper Postgres migration files in `prisma/migrations/`, swap that
for `prisma migrate deploy` (see below).

Tear down:

```bash
docker compose down       # keeps the postgres volume
docker compose down -v    # drops the volume (data loss)
```

## Standalone Docker

```bash
docker build -t prediq .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/prediq \
  -e DEMO_PASSWORD=demo1234 \
  -e MISTRAL_API_KEY=$MISTRAL_API_KEY \
  prediq
```

The image expects an external Postgres reachable from the container.

## Hosted platforms

Any container host that can pull a Docker image works. Tested-friendly:

- **Fly.io** — `fly launch` will detect the Dockerfile. Provision a
  Postgres add-on (`fly postgres create`) and `fly secrets set
  DATABASE_URL=...` to wire it.
- **Render / Railway** — both auto-build Dockerfiles. Add a managed
  Postgres, copy its `DATABASE_URL` into the web service env. Set
  `MISTRAL_API_KEY` in env if you want the news pipeline.
- **AWS ECS / GKE / etc.** — same pattern; treat the image as
  stateless, mount no volumes, the only persistent state is Postgres.

## Environment variables

Env is **validated at boot** by `server/config.js` (zod schema). A
misconfigured value kills the process immediately with a precise error
message rather than silently 500-ing requests later.

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes in prod** | Postgres URL in production. SQLite (`file:./dev.db`) for local dev. |
| `PORT` | no | 1–65535. Defaults to 3000. |
| `NODE_ENV` | no | `development` \| `test` \| `production`. Set `production` in prod (the Dockerfile already does). Toggles secure cookies. |
| `DEMO_PASSWORD` | no | Bootstraps the demo accounts (Alice/Bob/admin). Min 8 chars. **Must NOT be the default `demo1234` when `NODE_ENV=production` — boot fails otherwise.** |
| `GOOGLE_CLIENT_ID` | no | Enables the Google Sign-In button + `/api/auth/google` endpoint. |
| `MISTRAL_API_KEY` | no | Enables `/api/admin/news/ingest` to draft markets via Mistral. |
| `NEWS_INGEST_INTERVAL_MIN` | no | Positive integer in minutes. Enables the in-process cron. Recommended: `360` (every 6h). Unset = disabled. |
| `NEWS_DRAFT_MIN_CONFIDENCE` | no | Float in [0, 1]. Drafts below this confidence auto-reject as `REJECTED` instead of clogging the PENDING queue. Default 0.7. |
| `WEB_CONCURRENCY` | no | Worker count for `npm run start:cluster`. Defaults to CPU count. |

## Migrations (Postgres)

The dev workflow uses SQLite migrations under `prisma/migrations/`. These
won't apply cleanly against Postgres because the SQL dialects diverge
slightly. Two options for prod:

### Option A — `db push` (simplest, default)

The Dockerfile runs `prisma db push --skip-generate` on every container
start. This sync-creates the schema from `prisma/schema.postgres.prisma`.
Idempotent, but no migration history. Fine until you need column drops or
data migrations.

### Option B — proper migrations

```bash
# One-time setup
DATABASE_URL=postgresql://... \
  npx prisma migrate dev --schema prisma/schema.postgres.prisma \
  --name init --create-only
# Review the generated SQL, then apply
npx prisma migrate deploy --schema prisma/schema.postgres.prisma
```

Then change the Dockerfile `CMD` to:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node server/index.js"]
```

## Operational notes

- **Health check** — `GET /health`, no auth needed. Returns
  `{ ok, uptimeMs, dbMs, env }` on success and **503** with `{ ok: false }`
  if the Postgres ping fails — wire this directly to your orchestrator's
  liveness/readiness probe so a stuck DB pool gets the container replaced.
- **Request IDs** — every response carries an `X-Request-Id` header. If
  the request arrives with one (from an upstream proxy), it's preserved
  end-to-end; otherwise the server generates a 16-hex-char ID. Unhandled
  500 responses include `requestId` in the JSON body so users can quote it.
- **Structured logs** — JSON one-line per record in production
  (`level`, `msg`, `ts`, plus contextual fields like `reqId`, `method`,
  `path`, `status`, `ms`). Ready to ship straight into Loki / Datadog /
  CloudWatch / a flat file. `/health` is excluded from the request log
  to keep aggregators clean.
- **Sessions** — server-side, stored in the `Session` table, 30-day
  rolling expiry. Restarting the server doesn't log users out.
- **SSE** — `/api/markets/:id/stream` is a long-lived connection. Make
  sure your reverse proxy doesn't buffer (set `X-Accel-Buffering: no`
  for nginx, or use `proxy_buffering off`). Cloudflare's free tier
  closes idle connections at 100s; the server sends a comment heartbeat
  every 25s to keep them alive.
- **Rate limiting** — `/api/auth/login` and `/api/auth/register` are
  capped at 20 attempts per 15 min per (IP + handle). For multi-node
  deploys, replace the in-memory limiter (`server/rateLimit.js`) with
  Redis-backed counters.
- **News pipeline** — set `MISTRAL_API_KEY` and `NEWS_INGEST_INTERVAL_MIN`
  on exactly ONE container in a multi-node deploy. The current scheduler
  is in-process and doesn't coordinate across replicas.

## Backups

Take regular `pg_dump` of the production database. Critical tables:
`User`, `Session`, `Market`, `Outcome`, `SharePosition`, `Trade`,
`PriceSnapshot`, `CoinTransaction`. The append-only ledger
(`CoinTransaction`) is sufficient to reconstruct any user's chip
balance — keep it untruncated.
