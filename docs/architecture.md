# DecisionLoop — Architecture & Implementation Decisions

> Living document. Updated as the build progresses. Last updated: 2026-08-11.

## 1. What DecisionLoop is (and isn't)

DecisionLoop is **assumption-aware decision memory** for teams choosing between options (vendors,
architectures, strategies). It is not a chatbot, not a RAG demo, and not a CRUD app with an LLM
bolted on. The product claim is specific: when a team commits to a decision, DecisionLoop persists
*why* — the chosen option, the rejected alternatives, and the explicit assumptions the decision
depends on ("SignalForge is < $25K/year"). Weeks later, in a brand-new session, when new evidence
contradicts one of those assumptions, DecisionLoop notices on its own, marks the decision **AT
RISK**, explains the contradiction, and shows — via the **Memory Inspector** — exactly which rows
in CockroachDB it read to reach that conclusion.

Three features get disproportionate engineering attention:

1. **Assumption-aware decision memory** — structured `decisions` + `assumptions` (not free text).
2. **Automatic assumption invalidation** — new documents are compared against *stored* assumptions
   without being told which decision they relate to; retrieval finds the connection.
3. **Memory Inspector** — every AI action that touches memory writes a `memory_traces` row: the
   exact SQL, embedding similarity scores, retrieved row IDs, and the LLM's stated reasoning. The
   UI renders this as a provenance trail, and (real integration, not decoration) cross-checks it
   live against CockroachDB's own **Managed MCP Server**.

## 2. Defining demo (what "done" means)

- **Session 1**: user picks SignalForge over MetricLake for a workflow tool. They state (or the
  system extracts from a short exchange/doc) the reasoning and the assumption
  `price < $25,000/year`. User clicks **Commit Decision**. Session ends.
- **Session 2** (new browser session, no session-to-session hint from the user): user uploads a
  vendor pricing document showing SignalForge now costs **$42,000/year**. Without being told this
  relates to the earlier decision, DecisionLoop:
  1. embeds and extracts structured facts from the document,
  2. retrieves the SignalForge decision from CockroachDB via vector + structured search,
  3. detects that `$42,000 > $25,000` contradicts the stored assumption,
  4. flips the decision to **AT RISK**, writes a `conflict_events` row explaining the contradiction,
  5. suggests reconsidering MetricLake,
  6. the Memory Inspector shows the exact CockroachDB rows and similarity scores that drove step 2–4.
- All of this runs against the **deployed** app, backed by **real** CockroachDB persistence — no
  hard-coded "if filename contains SignalForge" branching.

## 3. Stack decisions

| Concern | Decision | Why |
|---|---|---|
| App framework | **Next.js 15, App Router, TypeScript** | One deployable for UI + API routes; fastest path to a polished demo UI; server actions avoid a separate backend process. |
| Styling | **Tailwind CSS v4** | Fast, consistent, no separate design-system build step. |
| Database | **CockroachDB Cloud** (Serverless/Basic), Postgres wire protocol | Required by the spec. Native `VECTOR` type + C-SPANN distributed vector indexing (v25.2+) means we don't need a separate vector DB — CockroachDB *is* the memory store. |
| DB driver | **`postgres` (porsager/postgres.js)**, raw parameterized SQL, hand-written migrations | CockroachDB has real dialect differences from Postgres (index syntax, `SHOW`, some type quirks). An ORM fights this. Raw SQL keeps the vector-index DDL and C-SPANN specifics visible and debuggable, which matters for a judge reading the code. |
| Auth | Email + password (bcrypt), signed httpOnly session cookie (`jose` HS256 JWT) | Enough real auth to demonstrate tenant isolation without pulling in an external IdP (extra credential we don't have, and not the point of the demo). |
| Multitenancy | `tenant_id` (a "workspace") on every table; every query scoped by session tenant; enforced in the repository layer, not ad hoc in route handlers | Cheap, auditable, testable. Row-Level Security is noted as a hardening follow-up, not required for the demo. |
| Object storage | **AWS S3**, presigned PUT for upload, presigned GET for retrieval | Spec requirement. Presigned URLs avoid proxying large files through the Next.js server. |
| LLM (extraction, conflict reasoning) | **Claude on Amazon Bedrock** (`BEDROCK_REASONING_MODEL_ID`, default Claude Sonnet 4.5's US cross-region inference profile), invoked via `@aws-sdk/client-bedrock-runtime`'s `InvokeModel` using the Anthropic message format, structured outputs (`output_config.format`) for every extraction call. Reached only through the `ReasoningProvider` interface (`lib/ai/reasoningProvider.ts`) — `lib/ai/bedrock.ts#BedrockReasoningProvider` is the sole implementation. | AWS-native reasoning is a named judging criterion, not just "an LLM somewhere" — Bedrock's `InvokeModel` structured-outputs support (GA Feb 2026) matches Anthropic's own `output_config.format` shape closely enough that this was a transport swap, not a rewrite. The interface keeps the transport swappable without touching `lib/ai/extraction.ts` / `lib/ai/conflict.ts`. Bedrock model access is opt-in per account/region in the console — an IAM key alone doesn't grant it. |
| Deterministic conflict check | Before any model call, `lib/ai/bedrock.ts#tryDeterministicConflictCheck` compares a stated numeric fact against an assumption's structured `{metric, operator, value, unit}` directly — no LLM involved when both sides are structured and the metric/unit match. | A pure numeric contradiction (`price < 25000` vs `price = 42000`) shouldn't need a model to detect. Falls through to the LLM judgment only for cross-metric, unstructured, or inequality-shaped facts. |
| Embeddings | **Amazon Titan Text Embeddings V2** on Bedrock (`BEDROCK_EMBEDDING_MODEL_ID`), requested at 512 dimensions; deterministic local hash-embedding fallback when `AWS_REGION` is unset (tests / offline dev) | Same AWS-native rationale as reasoning — one cloud provider for both. Titan V2 retains ~99% retrieval accuracy at 512 dims vs. its 1024 default. The fallback keeps `npm test` and local dev working without live AWS credentials. |
| CockroachDB MCP | Real client of CockroachDB's **Managed MCP Server** (`https://cockroachlabs.cloud/mcp`), invoked from the Memory Inspector API route, using a service-account API key | The Managed MCP Server is designed for AI dev tools, not app runtime traffic — so it is *not* on the hot path for every request. It is used specifically where its purpose lines up with ours: independently proving, through Anthropic's own MCP tool calls (`select_query`, `get_table_schema`), that the rows the Memory Inspector claims were used really are in CockroachDB. This is a genuine second, independent verification path, not a relabeled internal DB call. |
| Deployment | **AWS Amplify Hosting** (SSR, connects directly to the GitHub repo, builds on push) with a `Dockerfile` kept for an App Runner / ECS fallback | Needs no local Docker/AWS CLI to stand up; judges can watch a build in the Amplify console. |
| Observability | Structured JSON logs (`pino`), `audit_events` table for every mutating action, `/api/health` and `/api/observability/recent` endpoints | Enough to demonstrate the requirement without standing up Prometheus/Grafana for a hackathon judge to look at once. |

## 4. Data model (see `db/migrations/0001_init.sql` for the authoritative schema)

- `tenants`, `users`, `auth_sessions` — accounts and login.
- `decisions` — id, title, problem statement, chosen option, status
  (`ACTIVE` / `AT_RISK` / `RECONSIDERED`), reasoning text, timestamps.
- `decision_options` — every option considered, `is_chosen` flag, rejection reason.
- `assumptions` — structured, per decision: `statement`, machine-checkable `constraint`
  (`{"metric","operator","value","unit"}`), `status` (`VALID` / `INVALIDATED`).
- `documents` — uploaded files, S3 key, extracted text, per-document embedding.
- `memory_chunks` — the unified vector store: one row per retrievable unit (a decision summary, an
  assumption, a document excerpt), `embedding VECTOR(512)`, `source_type`, `source_id`. This is
  what gets vector-searched.
- `conflict_events` — a detected contradiction: which assumption, which document, the LLM's
  explanation, whether it changed a decision's status.
- `memory_traces` — **the Memory Inspector's data source.** One row per AI action that touched
  memory: the rendered SQL, the embedding query, the ranked candidate rows with similarity scores,
  which rows were actually used, and the model's reasoning trace.
- `audit_events` — actor, action, entity, before/after, tenant — for every mutating request.

## 5. Vector retrieval

CockroachDB `VECTOR(512)` columns with a C-SPANN vector index (`CREATE VECTOR INDEX ... USING
cosine`, CockroachDB ≥ v25.2). Migration DDL for the index is applied best-effort with a caught
fallback: if the target cluster's CockroachDB version doesn't yet support `CREATE VECTOR INDEX`,
queries fall back to a brute-force `ORDER BY embedding <=> $1 LIMIT k` scan (works today on any
CockroachDB with the `VECTOR` type and `pgvector`-compatible operators, just without the ANN
index). This keeps the demo working across CockroachDB Serverless cluster versions without
guessing wrong at build time.

## 6. Assumption-conflict detection (the core loop)

1. Document uploaded → text extracted → chunked → embedded → `memory_chunks` rows written.
2. A background-triggered (synchronous, for demo simplicity) analysis step:
   - Extracts structured "facts" from the new document via Bedrock (`{"subject","metric","value","unit"}`).
   - For each fact, vector-searches `memory_chunks` for the nearest **assumptions** across *all* the
     tenant's decisions (no hint about which decision) — this is what makes it "independently recall".
   - For each candidate assumption: try the deterministic numeric comparison first (§3); only if that's
     inconclusive, ask Claude (via Bedrock) to judge whether the fact **invalidates** the assumption,
     with a structured `{"invalidated": bool, "explanation": string, "suggestedOptionName": string}` output.
   - Every step (query embedding, SQL run, candidates + scores, verdict) is written to
     `memory_traces` before any decision status changes — so the Memory Inspector can show the
     trace even for the branch that produced no change.
3. If invalidated: assumption → `INVALIDATED`, decision → `AT_RISK`, `conflict_events` row written,
   audit event logged.

## 7. Auth & tenancy

- Signup creates a `tenant` + first `user`. Session cookie carries a signed `{userId, tenantId}`.
- Tenant-owned repository reads and writes take `tenantId` and scope their `WHERE` clauses by it;
  child-row helpers resolve ownership through the tenant-scoped parent — enforced by code
  conventions and integration tests, not just by discipline.
- Passwords hashed with bcrypt (cost 12). No plaintext secret ever touches a table.

## 8. Deployment target

AWS Amplify Hosting, connected to `github.com/Haseeb-Arshad/DecisionLoop`, `main` branch.
`amplify.yml` runs `npm ci`, linting, resumable migrations, and the production build. Environment
variables (CockroachDB connection string, S3 bucket/region, Bedrock model IDs, CockroachDB MCP
service key and cluster scope, session secret) are set in the Amplify console, never committed.
A `Dockerfile` is kept in the repo as a portable fallback (App Runner / ECS / any container
host) since it requires no extra setup beyond what Amplify already needs.

## 8b. Companion documents

This file records *stack* decisions. The rest of the design is documented separately so each
document has one job:

- [`memory-model.md`](memory-model.md) — how organizational memory is represented, the
  spec-name → schema-name mapping, validity states, hybrid retrieval scoring, and what the
  Memory Inspector reads.
- [`security.md`](security.md) — threat model, tenant isolation, the prompt-injection
  boundary, and an honest list of gaps.
- [`deployment.md`](deployment.md) — CockroachDB and AWS setup, Bedrock model access, running
  each tier of the test suite, troubleshooting.
- [`demo-script.md`](demo-script.md) — the three-minute walkthrough.
- [`judging-notes.md`](judging-notes.md) — where to look, and what is and isn't finished.

## 9. What's explicitly out of scope for the hackathon build

- Enterprise SSO/OAuth — plain email/password is enough to demonstrate tenant isolation.
- Row-Level Security policies in CockroachDB — noted as a hardening follow-up; app-layer scoping is
  the demo-time enforcement.
- Multi-region CockroachDB topology — single-region Serverless cluster is sufficient to prove the
  product claim.

## 10. Known limitations (explicit, not accidental)

- No rate limiting on auth or API routes — acceptable for a hackathon demo behind a single
  workspace; would add per-IP/per-tenant limits before any real traffic.
- No email verification or password reset flow — signup is immediate. Fine for a demo account;
  a real deployment would add both.
- Document chunking (`lib/engine/documentIngestion.ts`) is paragraph-based with a fixed-size
  fallback, not a token-aware splitter — sufficient for the pricing-sheet/short-report documents
  this demo targets, not for very large or densely-formatted documents.
- Conflict detection runs synchronously inside the upload-confirm request. Fine at demo volume;
  a production build would move it to a queue so a slow LLM call doesn't hold the HTTP request
  open.

## 11. Credentials this build needs (external services)

None of these block scaffolding, schema, or UI work — they're needed starting at the
"CockroachDB connectivity" and "document ingestion" steps:

- `DATABASE_URL` — CockroachDB Cloud connection string (Serverless or Basic cluster).
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_BUCKET_NAME` — for document
  storage, Bedrock reasoning + embeddings, and (later) app deployment. **Bedrock model access must
  also be enabled per model in the AWS console (Bedrock → Model access)** — the IAM credentials
  alone don't grant it, and a missing grant fails at call time, not at credential-check time.
- `BEDROCK_REASONING_MODEL_ID` — defaults to Claude Sonnet 4.5's US cross-region inference profile;
  override if your account has a different model enabled.
- `BEDROCK_EMBEDDING_MODEL_ID` — defaults to Amazon Titan Text Embeddings V2 (optional at dev time;
  falls back to a deterministic local hash embedding when `AWS_REGION` is unset).
- `COCKROACHDB_MCP_SERVICE_KEY` and `COCKROACHDB_MCP_CLUSTER_ID` — service-account API key and
  explicit cluster scope for CockroachDB's Managed MCP Server, used only by the Memory
  Inspector's independent-verification call. `COCKROACHDB_MCP_DATABASE` is optional and falls
  back to the database named by `DATABASE_URL`.
- `SESSION_SECRET` — random 32+ byte string for signing auth cookies.

All of these are read from environment variables only, documented in `.env.example`, and never
committed. See the README for exactly where to get each one.
