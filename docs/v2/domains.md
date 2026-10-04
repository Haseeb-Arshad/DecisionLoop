# Beyond code: domains

DecisionLoop's engine does not know about code. A coding agent asks "what governs these files?"; a support
agent asks "what governs this refund?"; a procurement agent asks "what governs this contract?". The same
decision, assumption, evidence and approval machinery answers all three. What differs is vocabulary, which
source systems are trusted, and how their payloads are read. A **domain profile** describes that as data.

Engineering is one profile among others, and it is the default. A deployment with no profile behaves exactly
as it did before domains existed; a test pins the wording agents receive.

## Use one

```bash
decisionloop init --profile support      # or sales, operations, planning, or a path to your own JSON
decisionloop serve --web
```

`init --profile` validates the file, copies it to `.decisionloop/profiles/`, records it as the workspace's
**primary domain**, and from then on:

- agents are addressed in that domain's words (MCP instructions, tool descriptions, "no decision governs
  this" text);
- new decisions default to that domain instead of `engineering`;
- a bare name such as `Acme Corp` becomes a resource of the profile's default type instead of a file path;
- `decisionloop_check_action` is available to agents.

List what is loaded with `decisionloop profiles`; check a file with `decisionloop profiles validate my.json`.
Shipped templates: [`profiles/support.json`](../../profiles/support.json), [`sales.json`](../../profiles/sales.json),
[`operations.json`](../../profiles/operations.json), [`planning.json`](../../profiles/planning.json).

Several profiles can be loaded at once; decisions carry their own `domain`, and each profile's source
authority table and extractors apply to events from its sources. Only the **primary** domain decides the
wording agents hear.

## What a profile contains

```json
{
  "id": "support",
  "label": "Customer support",
  "vocabulary": { "decision": "support policy", "resource": "policy, customer segment or product",
                  "action": "issue a refund, credit, exception or escalation" },
  "defaultResourceType": "entity",
  "resourceTypes": ["policy", "segment", "customer", "queue"],
  "predicateAliases": { "dispute_rate": "chargeback_rate_pct" },
  "subjectPrefixAliases": { "supplier": "vendor" },
  "authority": { "billing:dispute.report": 0.9, "helpdesk:*": 0.6, "social:*": 0.3 },
  "records": [ { "path": "dispute_report", "subjectField": "segment", "subjectPrefix": "segment",
                 "facts": [ { "field": "chargebackRatePct", "predicate": "chargeback_rate_pct", "unit": "%" } ] } ],
  "policies": [ { "scope": "evaluation", "name": "support_policy_review",
                  "when": { "domain": ["support"], "proposedValidity": ["INVALIDATED"] },
                  "actions": ["require_human_review"] } ]
}
```

| Field | Meaning |
|---|---|
| `vocabulary` | What this domain calls things. Generates the wording agents read unless `guidance` overrides a string. |
| `defaultResourceType` | Type given to a bare name. Unset keeps today's behaviour (a file path). |
| `predicateAliases`, `subjectAliases`, `subjectPrefixAliases` | Different names for one thing, so a comparison is exact instead of needing a model. |
| `authority` | How much each `source:type` is trusted (`0`–`1`; `source:*` is the fallback). This is what lets a signed report invalidate an assumption while a forum post can only challenge it. |
| `records` | How to turn a structured payload into facts: which key holds the record, which field names the subject, which fields become which facts. |
| `acceptMetrics` | Also read `payload.metrics: [{ subject, metric, value, unit }]` (default on). |
| `policies` | Review rules. They can only add review; they cannot make weak evidence stronger. |

A profile is **data only**: no code, no expressions, no network. A malformed profile stops startup with the
file name and the exact problem rather than half-loading. Sources and authority come from the credential and
the profile, never from a payload.

## Constraints a machine can check in any domain

Beyond the engineering rules (`dependency_present`, `dependency_absent`, `path_protected`):

```json
{ "statement": "Refunds above $200 need a person", "severity": "BLOCKING",
  "rule": { "kind": "fact_bound", "predicate": "refund_amount_usd", "operator": "<=", "value": 200, "unit": "USD" } }
{ "statement": "Annual vendor cost stays at or under $100k",
  "rule": { "kind": "fact_bound", "subject": "vendor:*", "predicate": "annual_cost", "operator": "<=", "value": 100000, "unit": "USD/year" } }
{ "statement": "No outreach to accounts on legal hold", "severity": "BLOCKING",
  "rule": { "kind": "resource_protected", "resources": ["customer:globex", "customer:initech"] } }
```

They are compared by code. A value in another unit, or about another subject, is never treated as a violation.
Wildcards (`vendor:*`, `customer:enterprise/**`) work for every resource type.

## Before an action: `check_action`

```bash
decisionloop act "Refund order 1234 for \$350" --resource policy:refunds \
  --fact '{"predicate":"refund_amount_usd","valueType":"NUMBER","value":350,"unit":"USD","statement":"Refund of $350"}'
```

Returns `clear`, `caution`, `stop` or `no_decision`, with the governing decisions and any constraint the
values would break. It is advisory and read-only: it cannot stop an agent, it records what the agent was
told (visible under **Agent sessions**), and it writes no evidence. `stop` means a `BLOCKING` constraint
would be broken; `caution` means an advisory constraint, an at-risk decision or a challenged assumption.

`decisionloop act` exits with code 2 on `stop`, so a script can gate on it.

Available over HTTP (`POST /api/v1/actions/check`), MCP (`decisionloop_check_action`), the SDK
(`dl.actions.check`) and the CLI (`decisionloop act`). Example agent:
[`integrations/custom-agent/check-before-acting.ts`](../../integrations/custom-agent/check-before-acting.ts).

## Feeding it from source systems

Give each system its own key, bound to a source:

```bash
decisionloop key create --name erp --source procurement      # prints the key once
curl -X POST $DECISIONLOOP_URL/api/v1/events -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"type":"quote.received","externalId":"quote-2041","payload":{"quote":{"vendor":"Globex","annualCost":140000,"currency":"usd"}}}'
```

The event is attributed to `procurement` because of the key. The profile's table sets its authority
(`procurement:quote.received` → 0.85) and its `records` mapping reads `payload.quote` into facts. The same
`externalId` sent twice creates nothing new. An agent key cannot post events.

## It learns what you confirm

When a person accepts a conflict that a model had to judge because two records named one thing differently
(`payment_disputes_ratio` vs `chargeback_rate_pct`), a **suggested rule** appears under **Reviews**. Approve it
and that pair is compared by code from then on: no model call, same answer every time. Nothing changes until
a person approves, and a rejected suggestion is not offered again.

## What is not done

- Only predicate aliases are learned. Suggesting lower authority for a source whose conflicts keep getting
  dismissed, and inferring a decision's domain, are not built.
- Only the primary domain sets agent wording. A workspace serving two very different domains to the same agents
  gets one vocabulary.
- Nothing here has been run on real support, sales or procurement work. The evaluation
  (`npm run eval`, cases A7, B4, L1–L5, M1–M3) uses a synthetic workspace; it shows the mechanics work, not that
  the judgments are good on your data.
- Qualitative assumptions (`TEXT`) still need a reasoning model to be judged.
