# Dogfooding plan

DecisionLoop is not ready because tests pass. It is ready when it measurably helps on real work.

## Scope

Three repositories that are actively changed with coding agents: DecisionLoop itself and two others. At
least 30 agent tasks per repository over at least three weeks.

## Setup per repository

1. `decisionloop init`, bind the repository, install the GitHub App (advisory mode).
2. Import 5–15 genuine decisions from ADRs, READMEs and AGENTS.md — with rejected alternatives and
   structured assumptions where honest.
3. Connect the agent over MCP and install the hooks ([agents.md](agents.md)).

## What to record

Append one JSON object per task to `evals/dogfood/log.jsonl` (format:
[`evals/dogfood/log.example.jsonl`](../../evals/dogfood/log.example.jsonl)):

- task, agent, repository, date
- decisions returned by `get_context` (ids) and token estimate
- usefulness, rated by the person: 0 (noise), 1 (neutral), 2 (changed or confirmed the approach)
- **missed decisions** — a relevant decision that was not returned (false negative)
- **irrelevant decisions** — returned but not relevant (false positive)
- proposals made / approved / rejected (and why)
- conflicts and constraint findings raised / dismissed as false positives (with the reason)

The control plane already records most of this (Agents, Approvals, Triggers); the log adds the human
judgements that only a person can make.

## Exit criteria for the developer preview

| Measure | Target |
|---|---|
| Context precision on rated tasks | ≥ 0.7 |
| Missed relevant decisions | ≤ 1 in 10 tasks |
| Conflict / finding false-alert rate | ≤ 20 % |
| Proposal acceptance | tracked; low acceptance means agents are proposing noise |
| Cross-tenant leakage | 0 |
| Authoritative change from an untrusted source | 0 |

Every false positive and every miss becomes an evaluation case in [`evals/dataset.ts`](../../evals/dataset.ts)
before it is fixed.
