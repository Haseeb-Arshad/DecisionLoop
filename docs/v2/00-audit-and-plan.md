# DecisionLoop 2.0 — Architectural Audit, Gap Analysis and Implementation Plan

Status: working document for the 2.0 migration. Written **before** any 2.0 code changed, from a
full read of the repository at `3d2cca3`. Every claim about current behaviour below cites the
file it was verified in.

Baseline at audit time: `tsc --noEmit` clean; `vitest run` → 96 passed, 11 skipped (every
DB-backed integration test skips without a CockroachDB `DATABASE_URL`, so in practice **no
persistence test runs in CI or locally**).

---

## 1. Audit — classification of every major subsystem

| Subsystem | Where | Verdict | Why |
|---|---|---|---|
| Decision lifecycle rules (`canTransition`, severity classification, source authority) | `lib/domain/decisionStatus.ts` | **KEEP** (move into core) | Pure, tested, correct. `classifyConflictSeverity` is the single best idea in the repo: weak evidence *challenges*, strong evidence *invalidates*, a human decides. Becomes the default policy in the trigger engine. |
| Structured decision model (decisions, options, assumptions) | `db/migrations/0001,0003`, `lib/repo/decisions.ts` | **GENERALIZE** | Right shape, too narrow: no affected resources, no domain/scope, no origin/attribution (human vs agent), assumptions only numeric `metric/operator/value/unit`, no constraints distinct from assumptions. |
| Assumption validity states (VALID/UNCERTAIN/CHALLENGED/INVALIDATED/SUPERSEDED) | `lib/types.ts`, 0003 | **KEEP** | Correct set. `EXPIRED` evaluated in §8 below and **rejected**: an assumption past its review date is not known to be false, so expiry is modelled as a `CHALLENGED` transition with conflict type `ASSUMPTION_EXPIRED` (type already exists). |
| Deterministic conflict check | `lib/ai/bedrock.ts#tryDeterministicConflictCheck` | **KEEP BUT REFACTOR** | Correct principle, wrong home: lives inside the Bedrock provider, so "deterministic before model" is a property of one provider rather than of the engine. Numeric `=` facts only. Move to core as a typed evaluator family (numeric, boolean, categorical, temporal, version, set). |
| Hybrid retrieval scoring | `lib/engine/retrieval.ts` | **KEEP** (pure part → core) | Weighted, tested, no freshness penalty on decisions — good. Missing a *structural* signal (resource match), which is what makes coding-agent context precise. |
| Vector search in SQL, tenant-scoped in WHERE | `lib/repo/memoryChunks.ts` | **KEEP** | Correct isolation property. |
| Memory chunks / decision indexing | `lib/engine/decisionMemory.ts` | **KEEP BUT REFACTOR** | Delete-then-insert re-index is outside a transaction (a crash between them leaves a decision unretrievable until retried; status column records it, so recoverable). Needs origin-session provenance (§19 fix). |
| Conflict detection pipeline | `lib/engine/conflictDetection.ts` | **REPLACE** (by trigger engine) | Core idea is right (not told which decision; retrieves across all assumptions). But: document-only input, numeric-only facts, ~8 separate non-transactional writes per contradiction, trace written *after* mutations, no policy layer, no event model. Becomes one *consumer* of the generic trigger engine (a document upload is one event type). |
| Document ingestion | `lib/engine/documentIngestion.ts` | **KEEP BUT REFACTOR** | Chunking/hashing/page attribution fine. Runs synchronously in the upload-confirm HTTP request (documented limitation). Moves onto the durable job queue. |
| Agent runs | `lib/engine/agentRun.ts`, `lib/repo/agentRuns.ts` | **GENERALIZE** | Good wrapper. Needs external-agent sessions (Claude Code / Codex / Copilot), context-request intent, trigger-evaluation intent. |
| Memory traces / retrieval events / Memory Inspector | `lib/repo/memoryTraces.ts`, `app/(app)/inspector` | **KEEP** | Real provenance, not illustrative. Extend to trigger evaluations and agent sessions. |
| Memory events (append-only) vs audit events | `lib/repo/memoryEvents.ts`, `auditEvents.ts` | **KEEP** | Right separation. |
| Human decision actions (reopen/dismiss/accept/supersede) | `lib/engine/decisionActions.ts` | **KEEP BUT REFACTOR** | Correct semantics; each action is 3–5 non-transactional writes. Wrap in store transactions. |
| Idempotent commit (Idempotency-Key, fingerprint, memory_index_status) | `app/api/decisions/route.ts`, 0004 | **KEEP BUT REFACTOR** | Solid, but ~200 lines of business logic live in a Next.js route handler — unreachable from MCP/CLI. Move to a core service. |
| Reasoning provider abstraction | `lib/ai/reasoningProvider.ts`, `bedrock.ts` | **GENERALIZE** | Interface exists; one implementation; interface is document/numeric-specific. Add qualitative facts + a generic `judgeAssumption`. Add OpenAI-compatible provider. |
| Embedding provider | `lib/ai/embeddings.ts` | **GENERALIZE** | Titan + a SHA-256 fallback whose similarity is *meaningless*. Replace fallback with a deterministic **lexical feature-hashing** embedding so offline similarity reflects token overlap. |
| Prompt-injection boundary | `lib/ai/promptSafety.ts` | **KEEP** (move to core) | Extend to every external source (PR bodies, issue comments, agent-supplied text). |
| Auth (email/password, JWT + DB session) | `lib/auth/*` | **KEEP** | Add API keys for machine clients (MCP/SDK/CLI/hooks) with scopes. |
| Tenant isolation | repo layer + tests | **KEEP** | Add tenant-isolation cases to the eval suite so they run without CockroachDB. |
| CockroachDB MCP *client* (Inspector cross-check) | `lib/mcp/cockroachClient.ts` | **KEEP** | Independent verification path. Unrelated to DecisionLoop's own MCP server. |
| Migration runner | `db/migrate.ts` | **KEEP BUT REFACTOR** | Add dialect support (CockroachDB / PostgreSQL+pgvector / embedded PGlite). |
| DB client | `db/client.ts` | **KEEP BUT REFACTOR** | Global singleton; fine for the app. Storage layer takes an injected handle so workers/CLI/tests can own their connection. |
| S3 upload | `lib/aws/s3.ts` | **KEEP** | Optional in local mode (text evidence doesn't need object storage). |
| Next.js pages | `app/(app)/*` | **GENERALIZE** | Becomes the control plane; add Approvals, Triggers, Agents views. |
| Next.js API routes | `app/api/*` | **KEEP** + **NEW** `/api/v1` | Existing cookie-auth routes keep the UI working. New versioned API for machine clients, thin over core services. |
| Unit tests | `tests/unit` | **KEEP** | All still valid. |
| Integration tests | `tests/integration` | **KEEP BUT REFACTOR** | Never run without CockroachDB Cloud. Run them against embedded PGlite by default. |
| E2E (Playwright) | `tests/e2e` | **KEEP** | Needs live AWS; unchanged. |
| `verify-memory` / `reset-demo` scripts | `scripts/` | **KEEP** | |
| MCP server (DecisionLoop as a server) | — | **NEW** | P0. |
| Event inbox, trigger engine, policies, durable jobs, worker | — | **NEW** | |
| CLI, TypeScript SDK | — | **NEW** | |
| GitHub integration, agent hooks | — | **NEW** | |
| Engineering domain pack, decision dependencies, blast radius, approvals | — | **NEW** | |
| Behavioural evaluation suite | — | **NEW** | |

Nothing is classified **REMOVE**. The SignalForge demo data stays as a fixture.

---

## 2. Gap analysis against the 2.0 specification

| Spec area | Current state | Gap |
|---|---|---|
| Headless core (§2A) | Engine is *mostly* headless already — only `lib/auth/session.ts` and `lib/api/handler.ts` import Next. But engine functions call repos through a global SQL singleton, and commit logic lives in a route handler. | No storage port; no injectable dependencies; business logic in `app/api/decisions/route.ts`. |
| Integration surface (§2B) | Cookie-authenticated Next routes only. | No MCP server, no versioned API, no SDK, no CLI, no machine auth. |
| Universal decision object (§3) | title, problem, reasoning, options, assumptions, confidence, importance, status, project, supersession, created_by/session. | domain, scope, origin, agent attribution, affected resources, constraints, source references, tags, metadata, valid_from, reviewed_at. |
| Generalized assumptions (§4) | numeric `metric op value unit`. | boolean, categorical, temporal, version, set, qualitative; subject; verification policy; provenance. |
| Event model / inbox (§5) | None. Documents are the only evidence entry point. | Canonical event, idempotent inbox with retry state. |
| Trigger engine (§6) | Document-only conflict pass, synchronous. | Generic event → facts → affected decisions → evaluate → policy → transition → trace → emitted events. |
| Policies (§7) | One hard-coded rule (`classifyConflictSeverity`). | Configurable, explicit, small policy set. |
| MCP server (§8–9) | None. | All tools, including `get_context`. |
| Engineering pack / GitHub (§10–11) | None. | Resource types, dependency facts, PR analysis, advisory comments. |
| Agent pre/post-flight, hooks (§12–13) | None. | Context injection at session start, candidate decisions at stop. |
| CLI / SDK (§14–15) | None. | |
| Storage abstraction / Postgres (§16) | CockroachDB only; migrations use `STRING`, `CREATE VECTOR INDEX`. | Store interface; PostgreSQL+pgvector support; zero-infra local mode. |
| Pluggable providers (§17) | Bedrock only. | OpenAI-compatible reasoning + embeddings; provider selection by config. |
| Durable async processing (§18) | Synchronous in HTTP request. | Jobs table, retries, backoff, dead-letter, worker. |
| Evidence model (§20) | `documents` + `decision_evidence` link rows (upserted, i.e. **mutable**). | Immutable evidence items with kind, authority, event/ingestion time, normalized facts, provenance, corrections-as-new-records. |
| Dependencies / blast radius (§21–22) | None. | `decision_dependencies`, downstream traversal from real rows only. |
| Approvals (§25) | Human actions exist; no queue, no candidate decisions. | Approval requests; proposals as `DRAFT` decisions. |
| Agent run inspector (§24) | Internal agent runs only. | External agent sessions, context requests, proposals per session. |
| Eval suite (§27) | Unit tests of scoring and severity. | Behavioural cases A–K with measured precision/recall. |

---

## 3. Reusable unchanged

`lib/domain/decisionStatus.ts` (moves, same code), `lib/ai/promptSafety.ts` (moves), the pure half
of `lib/engine/retrieval.ts` (`resolveWeights`, `contextualScore`, `scoreCandidates`),
`lib/engine/documentIngestion.ts#chunkText*`/`hashContent`, `db/migrate.ts#splitSqlStatements`,
`db/ssl.ts`, every repository in `lib/repo/*` (the existing UI keeps using them),
`lib/mcp/cockroachClient.ts`, all existing migrations (never edited — see §6), all existing tests.

Moved modules leave a re-export at their old path, so no existing import breaks.

---

## 4. Technical debt and correctness gaps (verified)

1. **Cross-session recall can never be recorded.** `lib/engine/askDecisionLoop.ts` passes
   `originSessionByChunkId: {}`, and `conflictDetection.ts` passes no `sessionId` at all, so
   `scoreCandidates` never sets `crossSession = true`. The dashboard's "cross-session recalls"
   is structurally always 0, while `docs/memory-model.md §9` describes it as proven.
   **Fix:** record `origin_session_id` on each memory chunk at index time (backfilled from
   `decisions.created_in_session`), return it from vector search, and derive `crossSession`
   from it. Unknown origin stays *not* cross-session.
2. **Mutations can succeed while provenance fails.** In `judgeCandidate`, evidence → validity →
   conflict → memory event → status → audit are independent autocommits, and the memory trace
   is written after the loop. A failure part-way leaves an invalidated assumption with no
   conflict row, or an `AT_RISK` decision with no trace. **Fix:** the trigger engine applies
   each assumption transition + evaluation record + conflict + memory events + decision status
   in **one transaction**, and the evaluation record *is* the provenance (written in the same
   transaction, so neither exists without the other).
3. **Fact extraction is numeric-only.** The extraction prompt says "Only extract facts with an
   explicit number". "EU hosting discontinued", "SOC2 revoked", "library unmaintained" are
   invisible. **Fix:** qualitative facts (`subject`, `predicate`, boolean/text value).
4. **Extracted facts lack provenance.** `ExtractedFact` has `sourceQuote` but no location,
   extractor/model, timestamp, authority or content hash. **Fix:** facts are stored inside
   immutable evidence items carrying all of those.
5. **Evidence is mutable.** `createDecisionEvidence` upserts (`ON CONFLICT … DO UPDATE`),
   overwriting excerpt/relevance. Kept for the legacy link table; new evidence items are
   insert-only, with corrections as new rows pointing at what they supersede.
6. **Deterministic method inferred heuristically.** `conflictDetection.ts` labels a judgment
   DETERMINISTIC iff `confidence === 1 && conflictType === "VALUE_CHANGED"` — a model returning
   confidence 1.0 would be mislabelled. **Fix:** evaluators return their method explicitly.
7. **Business logic inside a route handler.** `app/api/decisions/route.ts` holds the commit
   pipeline. **Fix:** `DecisionService.commit` in core.
8. **Offline embeddings are semantically meaningless** (SHA-256 of whole text), so local dev
   retrieval is noise. **Fix:** lexical feature-hashing embedding.
9. **No DB test ever runs by default.** **Fix:** embedded PGlite test database.
10. Minor: `AUTHORITY_TOLERANCE` semantics are undocumented at call sites; `listOpenAssumptionsForTenant`
    is unused; `indexDecisionMemory` delete+insert not atomic.

---

## 5. Target package / module architecture

Packages are real directories with their own `package.json` (private until the public preview),
resolved today through TypeScript path aliases (`@decisionloop/*`) so the existing Next.js app,
`tsx`, and vitest consume them with **no build step and no workspace install**. They become npm
workspaces with a bundling step when the CLI/SDK are published (Phase 10). An automated test
enforces the dependency rules below.

```
packages/
  core/                 @decisionloop/core — NO Next/React/SQL/AWS imports
    src/types/          universal decision object, events, evidence, facts
    src/assumptions/    schema, normalization, deterministic evaluators
    src/lifecycle/      decision/assumption transitions, severity (moved)
    src/retrieval/      hybrid scoring (moved) + resource matching
    src/policy/         policy definitions + evaluation
    src/safety/         untrusted-content boundary (moved)
    src/ports/          DecisionStore, ReasoningProvider, EmbeddingProvider, Clock
    src/services/       context, decisions, evidence, triggers, approvals, blast radius
    src/domain-packs/   registry + engineering pack
  storage-sql/          @decisionloop/storage-sql — DecisionStore over postgres.js
                        dialects: cockroach | postgres (pgvector) | pglite (embedded)
  providers/            @decisionloop/providers — bedrock, openai-compatible, local-lexical, heuristic
  runtime/              @decisionloop/runtime — wires store+providers from env; job worker
  mcp/                  @decisionloop/mcp — MCP server (stdio + streamable HTTP)
  sdk/                  @decisionloop/sdk — typed HTTP client over /api/v1
  cli/                  @decisionloop/cli — `decisionloop …`
  github/               @decisionloop/github — webhook verification, PR analysis, advisory comment
integrations/           claude-code hooks, generic MCP configs, codex/copilot notes
evals/                  behavioural dataset + runner
app/                    Next.js control plane (+ /api/v1 thin handlers)
lib/                    existing app internals; delegate to core over time
```

Dependency rule: `core` ← `storage-sql`, `providers` ← `runtime` ← (`mcp`, `cli`, `app`, worker).
`sdk` depends only on `core` types. Nothing in `core` imports a provider, a database, or a framework.

**Deviation from the spec, deliberately:** one `storage-sql` package with dialects instead of
separate `storage-cockroach` and `storage-postgres`. The two differ in ~5 statements (type
spelling, vector index DDL); two packages would duplicate ~1,000 lines of identical SQL.

---

## 6. Database migrations (additive; no existing record is rewritten)

Existing migration files are never edited (they are recorded as applied on live clusters). New
migrations are written in portable SQL (`TEXT`, not `STRING`). The runner applies a narrow
dialect shim for the historical files on PostgreSQL (`STRING`→`TEXT`), skips CockroachDB-only
optional files, and runs `CREATE EXTENSION vector` first.

`0005_reasoning_infrastructure.sql`:

- `decisions` + `domain`, `scope`, `origin` (HUMAN/AGENT/IMPORT/INTEGRATION), `decided_by_type`,
  `decided_by_label`, `external_ref` (e.g. `ADR-018`), `tags TEXT[]`, `metadata JSONB`,
  `source_refs JSONB`, `valid_from`, `reviewed_at`, `agent_session_id`.
- `decision_resources` — affected resources: `(resource_type, resource_key, repository, relationship)`.
- `decision_constraints` — rules a decision imposes on future work (distinct from assumptions:
  violating a constraint flags the *change*; contradicting an assumption flags the *decision*).
- `assumptions` + `subject`, `predicate`, `value_type`, `expected JSONB`, `verification_policy`,
  `provenance JSONB`, `last_evaluated_at`. Existing numeric columns stay authoritative for
  numeric assumptions; `expected` covers the other value types.
- `evidence_items` — immutable evidence (kind, source, source_ref, subject, authority,
  confidence, occurred_at, ingested_at, content excerpt, content_hash, `facts JSONB`,
  provenance, `supersedes_evidence_id`), unique `(tenant_id, source, content_hash)`.
- `event_inbox` — canonical events, unique `(tenant_id, source, external_id)`, status,
  attempts, last_error, result.
- `jobs` — durable queue: kind, payload, status, attempts/max_attempts, `run_after` backoff,
  lock owner/time, dedupe key, last_error; `DEAD` is the dead-letter state.
- `assumption_evaluations` — one row per (event, assumption) check: method, relation,
  confidence, authorities, previous/next state, policy actions, explanation. This is the
  trigger engine's provenance.
- `conflict_events` + `evidence_item_id`, `event_id`; unique `(tenant_id, assumption_id, evidence_item_id)`.
- `approval_requests` — kind, subject decision, related decisions, conflict, payload, reason,
  requester, status (PENDING/APPROVED/REJECTED/NEEDS_EVIDENCE/LINKED), resolution.
- `decision_dependencies` — `(decision_id, target_type, target_id|target_key, relationship, importance)`.
- `agent_sessions` — external agent sessions; `agent_runs.agent_session_id`; new agent-run intents.
- `api_keys` — hashed keys with scopes (`read`, `propose`, `write`, `admin`).
- `repository_bindings` — GitHub repository → workspace/project routing, advisory mode flag.
- `workspace_policies` — per-workspace policy overrides (defaults ship in code).
- `memory_chunks` + `origin_session_id` (backfilled) — fixes gap §4.1.

---

## 7. Canonical event schema

```ts
interface DecisionLoopEvent {
  eventId?: string;            // assigned by the inbox
  workspaceId: string;         // resolved server-side, never trusted from payload
  source: "github" | "document" | "human" | "agent" | "api" | "ci" | "metrics" | string;
  externalId: string;          // idempotency key within (workspace, source), e.g. GitHub delivery id
  type: string;                // "pull_request.merged", "evidence.submitted", "document.uploaded" …
  occurredAt: string;          // ISO-8601, event time (not ingestion time)
  actor: { type: "user" | "agent" | "integration" | "system"; id?: string; label?: string };
  resources: Array<{ type: string; key: string; repository?: string }>;
  facts?: Fact[];              // structured facts supplied by the source, if any
  text?: string;               // untrusted free text (PR body, document excerpt) — data only
  payload: Record<string, unknown>;   // source-specific, bounded
  provenance: { url?: string; authority?: number; receivedVia: string; signatureVerified?: boolean };
}
```

Emitted (outbound) events use the same envelope with `source: "decisionloop"`:
`assumption.supported`, `assumption.challenged`, `assumption.invalidated`, `decision.at_risk`,
`decision.reopened`, `decision.superseded`, `approval.required`, `constraint.violated`,
`notification.requested`.

---

## 8. Generalized assumption schema

```ts
type ValueType = "NUMBER" | "BOOLEAN" | "CATEGORY" | "DATE" | "VERSION" | "SET" | "TEXT";
type Operator = "<" | "<=" | ">" | ">=" | "=" | "!=" | "IN" | "NOT_IN" | "CONTAINS" | "NOT_CONTAINS";

interface AssumptionSpec {
  statement: string;           // human statement — always kept
  subject: string | null;      // "vendor:signalforge", "service:auth", "package:redis"
  predicate: string | null;    // "annual_cost", "eu_data_residency", "immediate_revocation_required"
  valueType: ValueType;        // TEXT = qualitative → semantic evaluation only
  operator: Operator | null;
  expected: number | boolean | string | string[] | null;
  unit: string | null;
  confidence, importance, authority: number;   // [0,1]
  validFrom: string; validUntil: string | null;
  verificationPolicy: "DETERMINISTIC_FIRST" | "SEMANTIC_ONLY" | "MANUAL";
  provenance: { source: string; ref?: string; quote?: string; extractor?: string };
}
```

A fact is `{ subject, predicate, valueType, value, unit?, statement, quote?, location? }`.
Deterministic evaluation applies only when subject and predicate normalize equal (domain packs
may declare aliases) and value types are compatible; otherwise the evaluator returns
*not applicable* and — policy permitting — semantic evaluation runs. Qualitative assumptions
are never coerced into fake numbers.

**EXPIRED decision:** not added. Rationale in §1. `valid_until` passing produces an
`ASSUMPTION_EXPIRED` evaluation that moves `VALID → CHALLENGED` (re-verification required).

---

## 9. MCP tool contracts

All tools are workspace-scoped by the API key; no tool accepts a workspace id. Read tools carry
`readOnlyHint: true`. Tool text returned to agents labels stored content as recorded data.

| Tool | Scope | Input (abridged) | Output |
|---|---|---|---|
| `decisionloop_get_context` | read | `intent`, `repository?`, `resources[]` (paths/globs/keys), `maxDecisions?` | ranked decisions with rationale, rejected alternatives, active assumptions + states, constraints, open conflicts, superseded-by links, evidence citations, `summary` (agent-oriented), `tokenEstimate` |
| `decisionloop_search_decisions` | read | `query`, `status?`, `limit?` | scored decision summaries |
| `decisionloop_get_decision` | read | `id` or `externalRef` | full decision + history (memory events, conflicts, evidence) |
| `decisionloop_get_constraints` | read | `resources[]`, `repository?` | active constraints matching resources |
| `decisionloop_list_at_risk` | read | `limit?` | AT_RISK/REOPENED decisions with the assumptions that caused it |
| `decisionloop_get_conflicts` | read | `decisionId?`, `includeResolved?` | conflicts |
| `decisionloop_explain` | read | `id` | why it exists: rationale, alternatives, assumptions, evidence citations |
| `decisionloop_propose_decision` | propose | full decision draft + resources + constraints | `DRAFT` decision + approval request + related/conflicting decisions |
| `decisionloop_propose_assumption` | propose | `decisionId`, assumption spec | approval request |
| `decisionloop_add_evidence` | propose | kind, statement/text, facts[], resources[], sourceRef | evidence id + trigger job id (evaluation is async) |
| `decisionloop_record_outcome` | propose | `decisionId`, summary, sentiment | outcome |
| `decisionloop_commit_decision` | write | `decisionId` | commits only if policy allows the caller; otherwise returns `approval_required` |
| `decisionloop_accept_conflict` / `_dismiss_conflict` | write | `conflictId`, `note` | resolution |
| `decisionloop_supersede_decision` | write | `decisionId`, `supersededBy` | result |

Agent-originated evidence has capped authority (default 0.5) so an agent cannot invalidate an
authoritative assumption on its own say-so — it can only challenge.

---

## 10. Engineering domain pack

- **Resource types:** `repository`, `path` (glob, repository-scoped), `package` (`npm:redis`),
  `service`, `database`, `table`, `endpoint`, `infrastructure`, `architecture`.
- **Decision types:** architecture, dependency, data-store, auth/security, performance, API contract.
- **Assumption patterns:** throughput, latency, cost, scale, compatibility, deployment region,
  security requirement, version compatibility, team expertise, dependency maturity, API behaviour.
- **Fact extractors (deterministic):** changed files → `path` resources; manifest diffs
  (`package.json`, `requirements.txt`, `go.mod`) → `dependency_present` facts for `package:*`
  subjects; workflow failures → `ci_status` facts; release tags → `version` facts.
- **Constraint rules:** `dependency_present`, `dependency_absent`, `path_protected`.
- **Authority defaults:** merged PR 0.8, CI result 0.8, production metric 0.85, open PR 0.5,
  agent statement 0.5, issue comment 0.3.
- **Predicate aliases:** e.g. `p95_latency_ms`≈`latency_p95_ms`.

---

## 11. GitHub integration lifecycle

1. GitHub App installed on repositories; each repository bound to a workspace/project
   (`repository_bindings`).
2. Webhook → `POST /api/integrations/github/webhook`: verify `X-Hub-Signature-256`
   (HMAC-SHA256, constant-time) **before parsing**; reject unsigned/mismatched.
3. Normalize into a canonical event; `externalId = X-GitHub-Delivery` → inbox dedupes retries.
4. Enqueue a `process_event` job; respond 202 immediately.
5. Worker: fetch changed files (App installation token), derive resources and dependency facts
   via the engineering pack; PR body/comments are untrusted `text`.
6. Retrieve decisions by resource match + semantic similarity; evaluate constraints and
   assumptions; record evaluations.
7. `pull_request.opened/synchronize` → advisory check/comment summarizing relevant decisions
   and possible violations. **Advisory only; never blocks merge in alpha.** Each comment carries
   a feedback link so false positives are recorded (`dismiss` with reason).
8. `pull_request.closed && merged` → evidence with merged-PR authority; approved candidate
   decisions linked to the PR become ACTIVE per policy.

Personal access tokens are supported only for local development.

---

## 12. Dogfood evaluation plan

Repositories: DecisionLoop itself, plus two actively developed repositories of the maintainer.
Per repository: bind repository; import 5–15 genuine decisions (from ADRs/README/AGENTS.md);
install MCP + Claude Code hooks; run ≥ 30 real agent tasks over ≥ 3 weeks. Record in
`evals/dogfood/log.jsonl`: task, context returned (ids + token estimate), whether it was
useful (human-rated 0–2), missed decisions (false negatives), irrelevant decisions (false
positives), proposals made/accepted/rejected, conflicts raised/dismissed-with-reason.
Exit criteria for developer preview: context precision ≥ 0.7 on rated tasks, conflict false-alert
rate ≤ 20 %, zero cross-tenant leakage, zero authoritative mutation from untrusted sources.

---

## 13. External documentation verified (and still to verify)

Verified during this audit:
- MCP TypeScript SDK **1.30.0** installed: `McpServer.registerTool`, `StdioServerTransport`,
  streamable HTTP transports (read from `node_modules/@modelcontextprotocol/sdk/dist`).
- Claude Code hooks: `SessionStart`/`UserPromptSubmit`/`Stop` stdin fields and
  `hookSpecificOutput.additionalContext` output (code.claude.com/docs/en/hooks).
- CockroachDB supports `SELECT … FOR UPDATE SKIP LOCKED` (not on tables with multiple column
  families under SERIALIZABLE — our tables use one family).
- PGlite 0.5.8 + `@electric-sql/pglite-pgvector` + `@electric-sql/pglite-socket` 0.2.11:
  exercised — all four existing migrations apply with the `STRING→TEXT` shim; postgres.js
  transactions, `vector <=>` and `SKIP LOCKED` work over the socket.

To verify before the corresponding phase: GitHub App installation-token flow and Checks API
permissions; GitHub Copilot coding-agent hooks format; Codex MCP configuration format; OpenAI
embeddings `dimensions` parameter for 512-d output; CockroachDB `READ COMMITTED` availability
on Serverless for the worker.

---

## 14. Incremental implementation plan

Each phase leaves the existing app runnable and ends with tests green and a commit.

| Phase | Deliverable | Exit test |
|---|---|---|
| 1 | `packages/core`: moved pure modules (+ shims), universal types, assumption model + deterministic evaluators, policy engine, event schema, resource matching; boundary test | unit tests |
| 2 | Migration 0005; dialect-aware runner; embedded PGlite; `storage-sql` DecisionStore; providers (lexical embeddings, heuristic, Bedrock adapter, OpenAI-compatible); cross-session fix | integration tests on PGlite (existing ones un-skipped) |
| 3 | Event inbox, jobs + worker, trigger engine (transactional transitions + evaluation records), evidence service; legacy document pipeline routed through it | trigger integration tests |
| 4 | MCP server (stdio + HTTP), API keys, `get_context` | MCP client ↔ server test over stdio |
| 5 | `/api/v1`, SDK, CLI | CLI/SDK tests against a running local server |
| 6 | GitHub webhook + PR analysis + advisory comment renderer | signed-webhook tests, PR fixture tests |
| 7 | Claude Code hooks (pre-/post-flight), generic MCP configs | hook script tests |
| 8 | Control plane: Approvals, Triggers, Agents, Blast radius | build + render check |
| 9 | Eval suite A–K, alpha acceptance test (spec §40) | `npm run eval` |
| 10 | README/docs rewrite, Docker Compose, developer preview packaging | clone-to-result walkthrough |

---

## 15. Progress (updated as phases land)

| Phase | Status | Evidence |
|---|---|---|
| 1 Core extraction | Done | `packages/core`; boundary test |
| 2 Storage, migrations, providers | Done | migration 0005/0006; `SqlDecisionStore`; embedded PGlite; integration tests run by default |
| 3 Events, trigger engine, worker | Done | `services/triggers.ts`, `services/worker.ts`; story test |
| 4 MCP, API, SDK | Done | `packages/mcp`, `packages/api`, `packages/sdk`; HTTP + MCP client tests |
| 5 CLI | Done | `packages/cli`; exercised end to end in a scratch repository |
| 6 GitHub integration | Done (fake GitHub API) | `packages/github`; not yet run against a live App |
| 7 Agent hooks | Done (Claude Code reference) | `packages/cli/src/hooks.ts`; exercised with real hook payload shapes |
| 8 Control plane | Done (approvals, triggers, agents) | verified in the browser against a live server |
| 9 Evaluation | Done | `evals/`; gate test; alpha acceptance test (all 20 criteria) |
| 10 Documentation / preview packaging | Docs done; npm publishing pending | README, `docs/v2/*`, `integrations/*`, `docker-compose.yml` |
| Dogfooding | Not started | [dogfood.md](dogfood.md) |

Deviations from this plan, with reasons:
- One `storage-sql` package with dialects instead of separate Cockroach/Postgres packages (§5).
- Packages consumed from source via tsconfig paths plus `bin/decisionloop.mjs`; built npm packages come
  with the developer preview.
- Embedded mode is single-connection (pglite-socket interleaves extended-protocol cycles across
  connections), so `serve --web` hosts the control plane in-process; multi-process deployments use
  PostgreSQL or CockroachDB.
- `EXPIRED` validity not added (§8). Expiry sweeps (`valid_until` → CHALLENGED) are designed but not yet
  scheduled.
