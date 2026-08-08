# DecisionLoop

**Assumption-aware decision memory.** DecisionLoop remembers *why* a decision was made — not
just what was chosen — and notices, on its own, when new evidence invalidates the assumptions
that decision depended on. Built on CockroachDB as the memory store (structured data **and**
vector search, in the same database), with a Memory Inspector that proves, row by row, what
CockroachDB data drove each AI action.

> Full build rationale and the defining demo scenario: [`docs/architecture.md`](docs/architecture.md).
> This README is being filled in as the build progresses — see that doc for current status.

## The problem

Teams make a decision, write the reasoning in a Slack thread that scrolls away, and six months
later nobody remembers *why* they chose Vendor A over Vendor B — until the new intern re-litigates
it from scratch, or worse, nobody notices Vendor A tripled their price and the original reasoning
quietly stopped applying.

## What DecisionLoop actually does

1. **Commit a decision** — DecisionLoop extracts the options considered, the reasoning, and the
   concrete, checkable assumptions behind the choice (e.g. "SignalForge is < $25,000/year") and
   persists them as structured rows in CockroachDB, not a paragraph of prose.
2. **Time passes. A new session starts.** Someone uploads a new document — a pricing sheet, a
   incident report, an updated SLA — with no reference to the old decision.
3. **DecisionLoop independently recalls** the relevant decision via vector + structured retrieval
   over CockroachDB, checks the new facts against the decision's stored assumptions, and — if one
   no longer holds — marks the decision **AT RISK**, explains exactly why, and suggests
   reconsidering the alternative that was passed over.
4. **The Memory Inspector** shows the receipts: the exact SQL that ran, the embedding similarity
   scores, which rows were used, and (a real integration, not a relabeled internal query)
   independent verification via CockroachDB's own Managed MCP Server.

## Stack

Next.js (App Router, TypeScript) · CockroachDB (structured data + native `VECTOR` / C-SPANN
vector search) · Claude Opus 5 (extraction & reasoning) · Voyage AI (embeddings) · AWS S3
(document storage) · CockroachDB Managed MCP Server (independent memory verification) · AWS
Amplify Hosting (deployment).

See [`docs/architecture.md`](docs/architecture.md) for the full decision log.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL at minimum to run the app
npm run db:migrate           # applies db/migrations/*.sql to your CockroachDB cluster
npm run dev
```

Required and optional environment variables are documented in `.env.example`.

## Project layout

```
app/            Next.js App Router pages and API routes
components/     Shared UI components
db/             SQL migrations, connection pool, migration runner
lib/ai/         Claude extraction + conflict reasoning, embeddings
lib/aws/        S3 client, presigned upload/download
lib/auth/       Session cookies, password hashing
lib/mcp/        CockroachDB Managed MCP client (Memory Inspector verification)
lib/repo/       All SQL — the only layer that talks to CockroachDB
docs/           Architecture notes, demo script, screenshots
scripts/        Demo data seeding, one-off ops scripts
tests/          Unit + integration tests
```

## Status

Build in progress — this README and the demo walkthrough get finished last (see
`docs/architecture.md` §"what done means" and the task list this session is tracking against).
