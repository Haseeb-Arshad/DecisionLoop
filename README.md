# DecisionLoop

**Decision memory for humans and AI agents — and it knows when the reasons stop being true.**

DecisionLoop records *why* a system is built the way it is: the decision, the alternatives that were
rejected and why, the assumptions that made it reasonable, and the evidence behind it. Coding agents
ask it before they change things. When new evidence contradicts an old assumption — a merged PR, a
production metric, a vendor notice, a person's statement — DecisionLoop finds the affected decisions on
its own, marks them **at risk**, and warns the next agent that touches that code.

Git stores code history. Issue trackers store work history. Observability stores runtime history.
**DecisionLoop stores reasoning history — and keeps checking it against reality.**

> Status: **2.0 alpha.** The core, MCP server, HTTP API, SDK, CLI, GitHub integration, agent hooks and
> control plane work end to end and are covered by automated tests and a behavioural evaluation suite.
> It has not yet been dogfooded on production repositories; see [what's not done](#whats-not-done-yet).

---

## The story it exists for

1. **Months ago, an agent (or a person) decided** to use Redis-backed sessions instead of stateless JWTs,
   because customers need sessions revoked instantly. A person approved it. DecisionLoop recorded it as
   `ADR-018` — with the rejected alternative, the reason, and structured assumptions like
   `service:auth.immediate_revocation_required = true`.
2. **Today, a different agent is asked to "refactor authentication."** Before touching `src/auth/`, it
   calls `decisionloop_get_context`. It gets ~200 tokens: the decision, *why*, *"Rejected: Stateless JWT —
   cannot revoke sessions immediately"*, and the constraint to keep sessions revocable. Not the whole
   history — the part that governs these files.
3. **The agent proposes switching to JWT anyway.** DecisionLoop flags that ADR-018 explicitly rejected
   that option, and holds the proposal for a person. Agents can propose; only people make memory
   authoritative.
4. **Then reality changes.** A security review says revocation is no longer required. DecisionLoop is not
   told which decision that affects. It finds ADR-018 by the fact's predicate, checks
   `false ≠ true` deterministically (no model needed), invalidates the assumption, marks ADR-018
   **AT RISK**, and opens a review because the decision is high-impact.
5. **The next agent is warned automatically**, and the Inspector shows exactly which evidence, rules and
   stored memories produced that warning — and what every agent was told, when.

That whole flow is one automated test: [`tests/integration/alphaAcceptance.test.ts`](tests/integration/alphaAcceptance.test.ts).

## How it differs from agent memory and RAG

| | Chat/agent memory, RAG | DecisionLoop |
|---|---|---|
| Unit of memory | Text chunks | Structured decisions: options, rejection reasons, typed assumptions, constraints, affected resources |
| Relevance | Embedding similarity | Structural first (the decision governs `src/auth/**`), semantic second |
| Staleness | Silent | Assumptions are checked against every new piece of evidence |
| Contradiction handling | None | Deterministic comparison first, model only when needed; authority-weighted; policy-driven |
| Who can change history | Whoever writes | Agents propose; people approve; everything is append-only with provenance |

## Quick start (local, no cloud, ~5 minutes)

Requirements: Node 20.9+ and git. No database to install — local mode embeds PostgreSQL (PGlite + pgvector).

```bash
git clone https://github.com/Haseeb-Arshad/DecisionLoop && cd DecisionLoop
npm install
npm link            # puts `decisionloop` on your PATH
```

In the repository you want DecisionLoop to know about:

```bash
decisionloop init          # workspace, embedded database, scoped API keys in .decisionloop/
decisionloop serve --web   # API + MCP + worker + control plane on http://127.0.0.1:4318
```

Record a decision (JSON shape in [docs/v2/getting-started.md](docs/v2/getting-started.md)), then:

```bash
decisionloop context src/auth/session.ts     # what governs these files?
decisionloop check                           # do my local changes violate recorded constraints?
decisionloop doctor                          # server, keys, MCP, providers
```

Connect your agent (Claude Code, Codex, Copilot, Cursor): **[docs/v2/agents.md](docs/v2/agents.md)**.

## Architecture

```
            Control plane (Next.js)          Agents: Claude Code · Codex · Copilot · Cursor · custom
                     │                                     │ MCP (HTTP or stdio)
                     ▼                                     ▼
        ┌──────────── HTTP API /api/v1 · MCP /mcp · CLI · SDK ────────────┐
        │                DecisionLoopOperations (one contract)            │
        └──────────────────────────────┬──────────────────────────────────┘
                                       ▼
   ┌─────────────────────────── @decisionloop/core ───────────────────────────┐
   │ decisions · typed assumptions · evaluators · policies · trigger engine   │
   │ context · approvals · blast radius · domain packs (engineering first)    │
   └───────────┬───────────────────────────┬──────────────────────┬──────────┘
               ▼                           ▼                      ▼
     storage-sql (CockroachDB,     providers (Bedrock,      durable jobs + worker
     PostgreSQL+pgvector, PGlite)  OpenAI-compatible,       (SKIP LOCKED, backoff,
                                   offline lexical)          dead letter)
        ▲
   GitHub App webhooks · evidence from people, agents, metrics, documents
```

- **Core is headless**: no framework, database or model SDK imports (enforced by a test). Every surface
  calls the same services. See [docs/v2/00-audit-and-plan.md](docs/v2/00-audit-and-plan.md).
- **Assumptions are typed**: numbers, booleans, categories, dates, versions, sets — and qualitative ones,
  which are never forced into fake numbers.
- **Deterministic before semantic**: arithmetic and comparisons never go to a model. Without a model
  configured, qualitative checks are recorded as *unavailable*, not guessed.
- **Evidence has authority**: a merged PR outranks an open one; an agent's own report can challenge an
  assumption but never invalidate it; a contract outranks a blog post. Policies can only make outcomes
  more conservative.
- **Transactional provenance**: every state change commits in the same transaction as the evaluation
  record that explains it.
- **Storage**: CockroachDB remains first-class; PostgreSQL + pgvector and an embedded database work too.

## Surfaces

| Surface | Where | Notes |
|---|---|---|
| MCP server | `POST /mcp` (streamable HTTP) or `decisionloop mcp` (stdio) | Tools filtered by credential: agents never see commit/accept/dismiss/supersede |
| HTTP API | `/api/v1/*` | API keys (`Authorization: Bearer dl_…`) or the control-plane session |
| TypeScript SDK | [`packages/sdk`](packages/sdk/src/index.ts) | `dl.context.get(…)`, `dl.decisions.propose(…)` |
| CLI | `decisionloop …` | init, serve, doctor, context, check, decisions, show, explain, propose, evidence, approvals, hooks |
| GitHub App | `POST /api/integrations/github/webhook` | Signed webhooks, advisory PR comments ([setup](docs/v2/github-app.md)) |
| Control plane | `decisionloop serve --web` or `npm run dev` | Overview, decisions, at risk, approvals, triggers, agents, inspector |

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | CockroachDB or PostgreSQL + pgvector. Unset → embedded database (local mode) |
| `DECISIONLOOP_REASONING_PROVIDER` | `bedrock` \| `openai` \| `none` (default: `bedrock` if `AWS_REGION` is set, else `none`) |
| `DECISIONLOOP_EMBEDDING_PROVIDER` | `bedrock` \| `openai` \| `lexical` (default: `bedrock` if `AWS_REGION`, else offline `lexical`) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_REASONING_MODEL`, `OPENAI_EMBEDDING_MODEL` | Any OpenAI-compatible endpoint; used **only** when selected explicitly |
| `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_TOKEN` for local dev) | GitHub integration |
| `SESSION_SECRET` | Control-plane cookie signing (generated automatically by `serve --web` locally) |

Full list: [.env.example](.env.example). Production setup on CockroachDB + Bedrock: [docs/deployment.md](docs/deployment.md).

## Quality bar

```bash
npm test          # unit + integration (embedded PostgreSQL; or your DATABASE_URL)
npm run eval      # behavioural evaluation → evals/reports/latest.md
```

The evaluation seeds a realistic workspace and scores cases A–K (relevant decision retrieved; similar but
irrelevant decision doesn't dominate; supporting evidence; numeric and qualitative contradictions;
low- vs high-authority evidence; superseded decisions; tenant isolation; agent changes that violate —
or only look like they violate — a decision). Current dataset results: retrieval recall 1.00,
governing decision ranked first 1.00, conflict precision/recall 1.00, false alerts 0, tenant leaks 0,
~120-token average context. These are results on our dataset, not a claim about yours — dogfooding
([plan](docs/v2/dogfood.md)) is what will say whether it is useful.

## What's not done yet

- **Dogfooding.** Not yet run across real repositories and weeks of agent work; approval-acceptance and
  override rates can only come from that.
- **Qualitative judgments need a model.** Without one, they're flagged, not evaluated. Model quality for
  category E has not been measured on real data.
- **Embedded database is single-connection.** Run everything in one `decisionloop serve` process, or use
  PostgreSQL/CockroachDB for multiple processes.
- **Packages are consumed from source** (tsconfig paths + a launcher); publishing built packages to npm is
  part of the developer preview.
- **GitHub integration** is advisory-only by design and has been tested against a fake GitHub API, not a
  live App installation.
- The 1.x web routes (`/api/decisions`, `/api/documents`, …) still use the 1.x repository layer over the
  same tables; document uploads already go through the 2.0 trigger engine.

## Documentation

- [docs/v2/00-audit-and-plan.md](docs/v2/00-audit-and-plan.md) — audit, gap analysis, schemas, MCP contracts, phased plan
- [docs/v2/getting-started.md](docs/v2/getting-started.md) — first decision, first contradiction
- [docs/v2/agents.md](docs/v2/agents.md) — MCP + hooks for Claude Code, Codex, Copilot, Cursor
- [docs/v2/github-app.md](docs/v2/github-app.md) — GitHub App setup (advisory PR checks)
- [docs/v2/dogfood.md](docs/v2/dogfood.md) — how we will evaluate usefulness before announcing it
- [docs/memory-model.md](docs/memory-model.md), [docs/security.md](docs/security.md), [docs/architecture.md](docs/architecture.md) — 1.x design, still accurate for the parts described
- [docs/v1-README.md](docs/v1-README.md) — the original hackathon README

MIT licensed.
