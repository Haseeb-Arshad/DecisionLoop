# DecisionLoop — Memory Model

How organizational reasoning is represented in CockroachDB, and why it's shaped this way.

The short version: **memory must affect action**. If you deleted the CockroachDB memory, this
product would not degrade — it would stop working. Nothing here is a chat log with a vector
index bolted on.

## 1. The core idea

Most systems remember *what* was decided. DecisionLoop's schema is built around remembering
*why*, in a form a machine can later check:

```
Decision ──┬── Options considered (incl. the rejected ones, and why)
           ├── Assumptions ──── structured constraints that can become false
           ├── Evidence ─────── which document, which page, supporting or contradicting
           ├── Conflicts ────── when new evidence broke an assumption
           └── Outcomes ─────── what actually happened afterwards
```

An assumption is not prose. `"SignalForge pricing stays under $25,000/year"` is stored
alongside `{metric: annual_price, operator: <, value: 25000, unit: USD/year}` and a
normalized form `annual_price < 25000 usd/year`. That structure is the whole reason a
pricing notice arriving eight months later can be checked against it **without an LLM
having to decide whether two sentences disagree**.

## 2. Table map

Authoritative schema: [`db/migrations/`](../db/migrations). This is the conceptual map.

| Table | What it holds | Why it exists |
|---|---|---|
| `tenants` | Workspaces | The isolation boundary. Every query is scoped by `tenant_id`. |
| `users`, `auth_sessions` | Accounts and login | Attribution — who committed, reopened, dismissed. |
| `projects` | Groupings of related work | Decisions rarely stand alone; retrieval can be scoped to one. |
| `decisions` | Title, problem, reasoning, status, confidence, importance | The record itself. |
| `decision_options` | Every alternative, `is_chosen`, `rejection_reason` | A rejected option may become attractive later. The rejection *reason* is what makes that judgeable. |
| `assumptions` | Statement + structured constraint + validity + importance + authority | The memories that can be invalidated. This is the heart of the product. |
| `documents` | Uploaded evidence, S3 key, `source_type`, `authority_score`, `content_hash` | Provenance and trust weighting. |
| `memory_chunks` | Retrievable units with `VECTOR(512)` embeddings | The unified search surface — decisions, assumptions, and document excerpts all live here. |
| `decision_evidence` | Links a decision/assumption to a document excerpt and page | Answers "where did this fact come from?" |
| `conflict_events` | A detected contradiction, with old/new value, confidence, method, resolution | The audit record of every time memory disagreed with itself. |
| `memory_events` | Append-only trail of what happened to each memory | Powers the decision timeline. Never mutated. |
| `agent_runs` | One row per pipeline execution, with timings and counters | Makes the agent lifecycle queryable, not just logged. |
| `retrieval_events` | Per-candidate scores for one retrieval | The normalized form of what the Memory Inspector displays. |
| `decision_outcomes` | What actually happened after the decision | Closes the loop; feeds future judgement. |
| `audit_events` | Operator actions against the system | Distinct from `memory_events` — see §7. |

### Naming: spec vs. schema

`decision.md` §8 lists slightly different names. The mapping is deliberate and complete:

| Spec name | This schema | Why |
|---|---|---|
| `organizations` | `tenants` | Same concept. Renaming would churn every query for a cosmetic difference. |
| `decision_alternatives` | `decision_options` | Ours stores the chosen option too, via `is_chosen` — one table instead of two. |
| `decision_conflicts` | `conflict_events` | Same fields; the `_events` suffix matches the other append-oriented tables. |
| `document_chunks` | `memory_chunks` | Ours is broader: it holds decision and assumption memories as well as document excerpts, so one vector index serves all retrieval. |

## 3. Validity is temporal, not binary

An assumption is not simply true or false (§3 Principle 3, §10):

| State | Meaning |
|---|---|
| `VALID` | Holds, as far as any evidence seen shows. |
| `UNCERTAIN` | Recorded with low confidence; never firmly established. |
| `CHALLENGED` | Contradicted by evidence that wasn't authoritative or confident enough to settle it. **A human decides.** |
| `INVALIDATED` | Contradicted by evidence strong enough to settle it. |
| `SUPERSEDED` | The parent decision was replaced. The assumption *was* true as recorded; it's simply no longer live. |

`CHALLENGED` is the state that makes the system honest. Without it, either every weak
document rewrites history, or weak documents are silently ignored. Neither is acceptable.

Decisions have the matching lifecycle — `DRAFT → ACTIVE → AT_RISK ⇄ REOPENED`, with
`SUPERSEDED` and `ARCHIVED` terminal. Transitions are enforced in
[`lib/domain/decisionStatus.ts`](../lib/domain/decisionStatus.ts), not left to whoever
writes the next `UPDATE`.

## 4. Retrieval is hybrid, not just vector similarity

Cosine similarity alone would rank a semantically close but unimportant note from an
unverified source above a load-bearing, contract-backed assumption. So (§16):

```
final = 0.50·semantic + 0.20·importance + 0.15·authority + 0.15·contextual
```

Weights are configurable via `RETRIEVAL_WEIGHTS` and covered by
[`tests/unit/retrievalScoring.test.ts`](../tests/unit/retrievalScoring.test.ts), because §16
explicitly warns against implementing arbitrary weights and never checking what they do.

**Contextual is not freshness decay.** Old decisions are not penalised for being old — that
would be exactly backwards for a product about institutional memory. Recency only applies to
*document evidence*, where a newer pricing sheet genuinely supersedes an older one.

Every retrieval is scoped by `tenant_id` **in the SQL WHERE clause**, not filtered afterwards
in JavaScript. A post-filter would still let another tenant's rows influence which top-k came
back. See [`tests/integration/tenantIsolation.test.ts`](../tests/integration/tenantIsolation.test.ts).

## 5. Authority decides what a contradiction *does*

New evidence contradicting an assumption doesn't automatically invalidate it. The rule
([`classifyConflictSeverity`](../lib/domain/decisionStatus.ts)):

| Evidence | Confidence | Result |
|---|---|---|
| Authority ≥ assumption's (within 0.1) | ≥ 0.75 | `INVALIDATED`, decision `AT_RISK` |
| Materially weaker source | any | `CHALLENGED`, decision `AT_RISK` — a human decides |
| Any | 0.5–0.75 | `CHALLENGED` |
| Any | < 0.5 | Nothing recorded; the check is still traced |

Default authority by source: contract 0.95, vendor-official 0.85, internal analysis 0.75,
other 0.6, news 0.5, unverified 0.3.

This is the direct answer to §20: *"never allow a low-authority random document to silently
invalidate an important decision."*

## 6. Two ways a conflict is detected

**Deterministic first (§21).** When both sides are structured and the metric and unit match,
`price < 25000` vs `price = 42000` is resolved by arithmetic. No model call, confidence 1.0,
recorded as `detection_method: DETERMINISTIC`.

**Semantic fallback.** Cross-metric, unstructured, or inequality-shaped claims go to Claude
on Bedrock, which returns a relation (`SUPPORTS` / `CONTRADICTS` / `UPDATES` / `IRRELEVANT` /
`UNCERTAIN`), a confidence, an explanation, and the source quote. `IRRELEVANT` is the common
case and the model is told so — most retrieved pairs are about different subjects, and a
false `CONTRADICTS` would wrongly put a sound decision at risk.

## 7. `memory_events` vs `audit_events`

They answer different questions and are deliberately separate:

- **`memory_events`** — what happened *to a memory*. Created, retrieved, referenced,
  challenged, invalidated. Append-only; it is what the decision timeline renders, so every
  entry is a real recorded event rather than a narrative reconstructed from timestamps.
- **`audit_events`** — what an actor did *to the system*. Logins, uploads, commits,
  dismissals, MCP queries. The security and compliance record.

An assumption being invalidated by the agent is a memory event. A person dismissing that
conflict is both.

## 8. What the Memory Inspector reads

Every AI action that touches memory writes a `memory_traces` row **before** anything changes
— including when nothing conflicts, so "why didn't anything happen?" is answerable. Each
trace holds:

- the rendered SQL that ran (the real query shape, not a prettified approximation)
- every candidate with its four score components and final score
- which chunks were actually used in reasoning, distinct from merely retrieved
- the model's stated reasoning
- the scoring weights in force at the time

The same scores are also written as normalized `retrieval_events` rows. That duplication is
intentional: the events table powers aggregate metrics (average retrieval latency,
cross-session recall counts), while the trace is an immutable provenance snapshot of one
action that stays accurate even if the weights later change.

§23 is explicit that retrieval scores must never be fabricated. Nothing in the Inspector is
illustrative.

## 9. Cross-session recall, and how it's proven

`agent_runs.session_id` is derived from the auth session, not a per-request random value. A
retrieval where the memory's originating session differs from the retrieving session is
marked `cross_session = true` on the `retrieval_events` row and shown with a ✦ in the
Inspector.

Unknown origin is **not** counted as cross-session. An unproven claim here would undermine
the exact thing the product exists to demonstrate.

Automated proof: [`tests/integration/crossSessionMemory.test.ts`](../tests/integration/crossSessionMemory.test.ts)
commits in session A, holds no state, and requires session B to find the decision from a
query that names nothing about it.

## 10. Deliberate omissions

- **No embedding of raw conversation.** Chat turns are not memories. Decisions, assumptions,
  and evidence are.
- **No deletion on contradiction.** Invalidating an assumption sets a state and writes an
  event. The original statement, its evidence, and its history all remain.
- **No LLM in the write path for status changes.** Only `lib/engine/decisionActions.ts`,
  invoked by an authenticated user, or the conflict engine under the authority rules above,
  can change a decision's status. A document cannot reach those paths regardless of what it
  says — see [`security.md`](security.md).
