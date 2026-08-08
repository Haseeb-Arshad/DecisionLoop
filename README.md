# DecisionLoop

**Assumption-aware decision memory.** DecisionLoop remembers *why* a decision was made — not
just what was chosen — and notices, on its own, when new evidence invalidates the assumptions
that decision depended on. Built on CockroachDB as the memory store (structured data **and**
vector search, in the same database), with a Memory Inspector that proves, row by row, what
CockroachDB data drove each AI action.

Full build rationale: [`docs/architecture.md`](docs/architecture.md).

## The problem

Teams make a decision, write the reasoning in a Slack thread that scrolls away, and six months
later nobody remembers *why* they chose Vendor A over Vendor B — until the new intern re-litigates
it from scratch, or worse, nobody notices Vendor A tripled their price and the original reasoning
quietly stopped applying.

## What DecisionLoop actually does

1. **Commit a decision** — DecisionLoop extracts the options considered, the reasoning, and the
   concrete, checkable assumptions behind the choice (e.g. "SignalForge is < $25,000/year") and
   persists them as structured rows in CockroachDB, not a paragraph of prose.
2. **Time passes. A new session starts.** Someone uploads a new document — a pricing sheet, an
   incident report, an updated SLA — with no reference to the old decision.
3. **DecisionLoop independently recalls** the relevant decision via vector + structured retrieval
   over CockroachDB, checks the new facts against the decision's stored assumptions, and — if one
   no longer holds — marks the decision **AT RISK**, explains exactly why, and suggests
   reconsidering the alternative that was passed over.
4. **The Memory Inspector** shows the receipts: the exact SQL that ran, the embedding similarity
   scores, which rows were used, and — a real integration, not a relabeled internal query —
   independent verification via CockroachDB's own Managed MCP Server.

## The demo scenario this is built around

- **Session 1** — a team picks SignalForge over MetricLake for a workflow tool, on the assumption
  pricing stays under $25,000/year. They commit the decision.
- **Session 2, weeks later** — someone uploads SignalForge's new pricing notice: $42,000/year.
  They don't mention the earlier decision at all.
- **DecisionLoop** independently recalls the decision, detects the `< $25,000/year` assumption is
  now false, marks the decision **AT RISK**, explains the contradiction, suggests reconsidering
  MetricLake, and the Memory Inspector shows exactly which CockroachDB rows drove that conclusion.

`db/seed.ts` reproduces this scenario end-to-end through the same code paths the app itself uses
(see below).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS · TanStack Query + TanStack Table ·
CockroachDB (structured data + native `VECTOR`/C-SPANN vector search) · Claude Opus 5
(extraction & conflict reasoning) · Voyage AI (embeddings) · AWS S3 (document storage) ·
CockroachDB Managed MCP Server (independent memory verification) · AWS Amplify Hosting
(deployment).

Full decision log and rationale for every choice above: [`docs/architecture.md`](docs/architecture.md).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run db:migrate           # applies db/migrations/*.sql to your CockroachDB cluster
npm run dev
```

Open `http://localhost:3000`, create a workspace, and either use the UI directly or run:

```bash
npm run db:seed              # reproduces the SignalForge/MetricLake demo scenario
```

### Environment variables

All documented with where to get each one in [`.env.example`](.env.example). Minimum to run the
app at all:

| Variable | Required for |
|---|---|
| `DATABASE_URL` | Everything — CockroachDB Cloud connection string |
| `SESSION_SECRET` | Auth (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) |
| `ANTHROPIC_API_KEY` | Decision extraction, conflict judgment — the core product loop |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` | Document upload |
| `VOYAGE_API_KEY` | Real embeddings (optional — falls back to a deterministic local embedding for dev/tests, see `lib/ai/embeddings.ts`) |
| `COCKROACHDB_MCP_SERVICE_KEY` | The Memory Inspector's independent MCP verification panel (optional — degrades gracefully) |

### Tests

```bash
npm test        # vitest — pure-logic unit tests, no credentials needed
npx tsc --noEmit
```

## Deploying

**Primary path: AWS Amplify Hosting.**

1. In the Amplify console, connect this GitHub repository (`main` branch). Amplify picks up
   [`amplify.yml`](amplify.yml) automatically.
2. Set every environment variable from the table above in the Amplify app's environment variable
   settings.
3. Deploy. `amplify.yml` runs `npm run db:migrate` before `npm run build` on every deploy, so
   schema changes ship automatically and idempotently.

**Fallback path: any container host** (AWS App Runner, ECS, etc.) — `Dockerfile` builds a
self-contained Next.js standalone image; point it at the same environment variables.

## Project layout

```
app/            Next.js App Router pages and API routes
  (auth)/       Sign in / sign up
  (app)/        Authenticated shell: decisions, documents, Memory Inspector, audit log
  api/          Route handlers — the only place lib/repo functions get tenant-scoped input
components/     Shared UI (AppShell, DataTable, status badges)
db/             SQL migrations, connection pool, migration runner, demo seed script
lib/ai/         Claude extraction + conflict reasoning, embeddings
lib/aws/        S3 client, presigned upload/download
lib/auth/       Session cookies, password hashing, tenant-scoped auth context
lib/engine/     Orchestration: decision memory indexing, document ingestion, conflict detection
lib/mcp/        CockroachDB Managed MCP client (Memory Inspector verification)
lib/repo/       All SQL — the only layer that talks to CockroachDB
docs/           Architecture notes and decision log
tests/          Unit tests (vitest)
```

## Status

Application code, schema, and deployment configuration are complete and build cleanly
(`npm run build`, `npx tsc --noEmit`, `npm test` all pass). Deploying to a live CockroachDB
cluster / AWS account and running the full session-1 → session-2 demo against that deployment is
the remaining step — it needs real credentials (see the table above) that aren't available in
this environment. See [`docs/architecture.md`](docs/architecture.md) for what's built vs. what's
explicitly out of scope for the hackathon build.
