# DecisionLoop — Notes for Reviewers

A map of where to look, and an honest account of what is and isn't finished.

## 1. The claim in one paragraph

DecisionLoop stores *why* a decision was made — the alternatives, the reasoning, and the
concrete assumptions it depends on — as structured rows in CockroachDB. When new evidence
arrives in a completely separate session, with no reference to any prior decision, the system
recalls the relevant decision on its own, checks the new facts against its stored assumptions,
and marks it AT RISK if one no longer holds. The Memory Inspector then shows exactly which
CockroachDB rows caused that, with real similarity scores.

If you removed the CockroachDB memory, this product would not degrade — it would stop
working.

## 2. Where to look first

| To evaluate | Read |
|---|---|
| Is the memory model real? | [`db/migrations/0003_organizational_memory.sql`](../db/migrations/0003_organizational_memory.sql), [`memory-model.md`](memory-model.md) |
| Is retrieval more than cosine similarity? | [`lib/engine/retrieval.ts`](../lib/engine/retrieval.ts) + [`tests/unit/retrievalScoring.test.ts`](../tests/unit/retrievalScoring.test.ts) |
| Is the at-risk result hard-coded? | [`lib/engine/conflictDetection.ts`](../lib/engine/conflictDetection.ts) — and run `npm run verify:memory` |
| Is cross-session memory real? | [`tests/integration/crossSessionMemory.test.ts`](../tests/integration/crossSessionMemory.test.ts) |
| Is MCP decorative? | [`lib/mcp/cockroachClient.ts`](../lib/mcp/cockroachClient.ts) — §5 below |
| Is prompt injection handled? | [`lib/ai/promptSafety.ts`](../lib/ai/promptSafety.ts), [`security.md`](security.md) §4 |
| Can tenants leak into each other? | [`tests/integration/tenantIsolation.test.ts`](../tests/integration/tenantIsolation.test.ts) |

## 3. The three features we'd defend hardest

### Assumption-aware decision memory

An assumption isn't prose. `"SignalForge pricing stays under $25,000/year"` is stored with
`{metric: annual_price, operator: <, value: 25000, unit: USD/year}` and a normalized form.
That structure is why a pricing notice arriving months later can be checked against it
without an LLM having to decide whether two sentences disagree.

Validity has five states, not two. `CHALLENGED` — contradicted by evidence too weak to
settle it — is the state that keeps the system honest.

### Automatic assumption invalidation

`runConflictDetectionForDocument` is **never told which decision a document relates to**.
Nothing upstream passes a `decisionId`. It extracts facts, retrieves across the tenant's
entire assumption memory, and finds the connection itself.

What a contradiction *does* is decided by
[`classifyConflictSeverity`](../lib/domain/decisionStatus.ts), weighing model confidence
against the relative authority of the evidence and the assumption. An anonymous PDF can flag
a decision for review; it cannot invalidate a contract-backed assumption.

Where both sides are structured, no LLM is involved at all — `price < 25000` vs
`price = 42000` is arithmetic (§21).

### Memory Inspector

Every AI action that touches memory writes a `memory_traces` row **before** anything changes,
including when nothing conflicts. It records the real SQL, every candidate with its four
score components, which rows were used versus merely retrieved, and the model's reasoning.

Nothing displayed is illustrative. The ✦ marker means a memory was written by a different
session than the one that read it — and unknown origin is deliberately *not* counted, because
an unproven cross-session claim would undermine the whole point.

## 4. Deliberate engineering decisions

**CockroachDB as the only store.** Structured memory and vectors live in one transactional
database. No dual-write, no sync lag, and the Inspector can show one query spanning both.

**Deterministic before semantic.** Structured comparisons don't call a model. Cheaper, faster,
and auditable — and it means the demo's headline result is arithmetic, not a model's opinion.

**Weights are configurable and tested.** §16 warns against arbitrary weights; ours are
adjustable via `RETRIEVAL_WEIGHTS` and pinned by tests that assert the *behaviour* they exist
to produce.

**Old memories aren't penalised for being old.** Freshness applies only to document evidence,
where a newer pricing sheet genuinely supersedes an older one. Decisions decay in relevance
for no one.

**Human judgment is structural.** The AI recommends. Reopen / Accept / Dismiss / Supersede all
require an authenticated user, and none of them delete anything.

**`memory_events` and `audit_events` are separate.** One records what happened to a memory
(and drives the timeline); the other records what an actor did to the system.

## 5. Is the MCP integration real?

Yes, and it's used where its purpose genuinely fits rather than on the hot path:

1. **Memory Inspector cross-check** — re-reads the exact `memory_chunks` rows a trace claims
   it used, via `select_query`, through a channel that shares neither the app's connection
   pool nor its query builder.
2. **Decision Memory Analyst** (`/system`) — a catalogue of tenant-scoped analyst questions
   ("Which active decisions have challenged assumptions?") answered by real MCP tool calls,
   with the SQL and raw response shown.

The catalogue is fixed rather than free-form on purpose: an arbitrary-SQL endpoint over a
shared MCP credential would be a cross-tenant read primitive.

Without both `COCKROACHDB_MCP_SERVICE_KEY` and `COCKROACHDB_MCP_CLUSTER_ID`, both degrade to
an explicit "unavailable" message. We don't claim a verification that didn't happen.

## 6. Honest status

### Working and verifiable

Schema, retrieval, conflict detection, the full decision lifecycle, prompt-injection defense,
tenant isolation, Memory Inspector, MCP integration, observability, all UI pages are implemented.
Local static/unit/build gates pass when run without external infrastructure; database, AWS,
MCP, and deployed-browser claims still require the credentials and validation environment in
§7.

### Requires credentials to demonstrate

Everything model-driven needs Bedrock model access, which is opt-in per AWS account and
region. Without `AWS_REGION`, embeddings fall back to a deterministic local hash with **no
semantic meaning** — retrieval will not connect a pricing notice to a stored assumption.
`npm run verify:memory` reports which provider is actually in use.

### Not done

- **Not deployed.** No AWS account or CockroachDB cluster was available in the build
  environment. [`amplify.yml`](../amplify.yml) and [`Dockerfile`](../Dockerfile) are written
  and build-tested; the deploy itself hasn't run.
- **The §69 definition of done has not been executed against a deployment.** Locally the
  pipeline is exercised end-to-end by `db/seed.ts` and the integration tests, but §61 is right
  that localhost success isn't deployment success, and we're not claiming otherwise.
- **No screenshots**, for the same reason.
- **Integration and E2E tests have not been run against real infrastructure.** They're
  written and skip themselves cleanly without it.

### Known gaps, by choice

Rate limiting, email verification/password reset, MFA/SSO, CockroachDB RLS, queue-based
ingestion, virus scanning. All are listed with mitigations in [`security.md`](security.md) §8.
Chunking is paragraph-based with a bounded fallback rather than token-aware — adequate for
pricing sheets and short reports, not for large technical documents.

## 7. Fastest way to check we're not bluffing

```bash
npm ci
npm run test:unit              # 95 tests, no infrastructure

# with a CockroachDB cluster:
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... npm run test:integration   # cross-session + tenant isolation

# with AWS credentials and Bedrock access:
npm run db:seed                # runs the whole scenario through the real pipeline
npm run verify:memory          # asserts nothing is mocked or hard-coded
```

`verify:memory` checks the specific things §71 says must be true before claiming this works:
the schema is the full model, `memory_chunks.embedding` is a native `VECTOR` column, a real
embedding provider is in use, retrieval returns scored rows, at-risk decisions are backed by
real conflict rows and traces, and cross-session recall actually occurred.
