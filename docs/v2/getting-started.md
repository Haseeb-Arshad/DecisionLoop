# Getting started: first decision, first contradiction

About ten minutes, entirely local. Assumes you ran `npm install && npm link` in a DecisionLoop clone
(see the [README](../../README.md)).

## 1. Initialise and start

In the repository you want DecisionLoop to know about:

```bash
decisionloop init
decisionloop serve --web
```

`init` creates `.decisionloop/` (added to `.gitignore`) holding the embedded database and two API keys:

- `local-admin` — you. Full access, including committing decisions and resolving approvals.
- `local-agents` — for coding agents. Read + propose only; agents can never make memory authoritative.

`serve --web` runs the API (`/api/v1`), MCP (`/mcp`), the job worker and the control plane on
`http://127.0.0.1:4318`. To sign in to the control plane, create a user for the workspace (the password
is read from the environment so it never lands in shell history):

```bash
DECISIONLOOP_USER_PASSWORD='…' decisionloop user create --email you@example.com
```

## 2. Record a decision

Save as `adr-018.json`:

```json
{
  "title": "Use Redis-backed server-side sessions",
  "externalRef": "ADR-018",
  "chosenOption": { "name": "Server-side sessions in Redis" },
  "alternatives": [
    { "name": "Stateless JWT", "rejectionReason": "JWTs cannot be revoked immediately; customers require instant revocation." }
  ],
  "rationale": "Enterprise customers require immediate session revocation when an employee is offboarded.",
  "assumptions": [
    {
      "statement": "Customers require immediate session revocation",
      "subject": "service:auth", "predicate": "immediate_revocation_required",
      "valueType": "BOOLEAN", "operator": "=", "expected": true, "importance": 0.95
    },
    {
      "statement": "Redis p95 lookup stays under 15 ms",
      "subject": "infrastructure:redis", "predicate": "p95_latency_ms",
      "valueType": "NUMBER", "operator": "<", "expected": 15, "unit": "ms"
    },
    { "statement": "The platform team keeps Redis operational expertise" }
  ],
  "constraints": [
    { "statement": "Sessions stay server-side and revocable (keep Redis)", "rule": { "kind": "dependency_present", "subject": "npm:redis" } }
  ],
  "resources": ["src/auth/**", "src/session/**"],
  "importance": 0.9
}
```

```bash
decisionloop propose --commit --file adr-018.json
```

`--commit` makes it authoritative immediately because *you* are committing it. Without `--commit` (and
always for agents) it becomes a proposal in the approval queue.

### Assumption types

| `valueType` | Operators | Example `expected` |
|---|---|---|
| `NUMBER` | `<` `<=` `>` `>=` `=` `!=` | `25000` (with `unit`) |
| `BOOLEAN` | `=` `!=` | `true` |
| `CATEGORY` | `=` `!=` `IN` `NOT_IN` | `"EU"` or `["EU","CH"]` |
| `DATE` | `<` `<=` `>` `>=` `=` `!=` | `"2027-01-01"` |
| `VERSION` | `<` `<=` `>` `>=` `=` `!=` | `"4.2"` |
| `SET` | `CONTAINS` `NOT_CONTAINS` | `"SOC2"` |
| `TEXT` (default) | — | Qualitative; judged by a model if one is configured, otherwise flagged |

`subject` + `predicate` are what let evidence find an assumption without an embedding. Use
`type:name` subjects (`service:auth`, `vendor:signalforge`, `npm:redis`).

## 3. Ask what governs some code

```bash
decisionloop context src/auth/session.ts --intent "Replace the session implementation"
```

## 4. Contradict an assumption

```bash
decisionloop evidence add \
  --statement "Security review: immediate revocation is no longer required" \
  --fact '{"subject":"service:auth","predicate":"immediate_revocation_required","valueType":"BOOLEAN","value":false,"statement":"No longer required"}'
decisionloop decisions --at-risk
```

The worker evaluates the evidence within a second: deterministic comparison, authority check (a person
outranks an agent), policy (`high_impact_architecture` asks for review), and ADR-018 moves to **AT RISK**.
Open **Triggers** in the control plane to see every check it made, and **Approvals** to review it.

## 5. Check a change before committing

Remove `redis` from `package.json` and edit a file under `src/auth/`, then:

```bash
decisionloop check
```

It reports that the change violates ADR-018's constraint — advisory, never blocking unless you pass
`--strict` in your own tooling.

## Next

- [Connect your coding agent](agents.md)
- [Install the GitHub App](github-app.md) for advisory PR comments
- Use PostgreSQL instead of the embedded database: `docker compose up -d` then
  `DATABASE_URL=postgres://decisionloop:decisionloop@127.0.0.1:5432/decisionloop?sslmode=disable decisionloop serve --web`
