# Connecting agents

DecisionLoop is an MCP server. Any agent that speaks MCP can ask it for context before acting and
propose decisions afterwards. Coding agents are the reference integration below; agents in other domains
(support, sales, procurement, operations) connect the same way and are addressed in their domain's words: see
[domains](domains.md). Configuration files for each client live in
[`integrations/`](../../integrations).

Give agents the **`local-agents`** key (read + propose) from `.decisionloop/credentials.json`, never the
admin key. With an agent key the MCP server does not even list the tools that commit decisions or
resolve conflicts, and the services refuse them underneath regardless.

```bash
export DECISIONLOOP_AGENT_KEY="$(node -p "require('./.decisionloop/credentials.json').agentKey")"
```

## Transport: HTTP (recommended) or stdio

- **HTTP** — the agent connects to `http://127.0.0.1:4318/mcp` with `Authorization: Bearer <agent key>`.
  Requires `decisionloop serve` running.
- **stdio** — the client launches `decisionloop mcp`, which calls the same HTTP API. Use this for clients
  without HTTP MCP support.

Either way the agent never holds database credentials.

Send `X-DecisionLoop-Agent: <name>` (and, if you can, `X-DecisionLoop-Session: <id>`) so the Agent Run
Inspector groups calls by agent session. Agents can also pass `agent` + `agentSessionId` on
`decisionloop_get_context`.

## Claude Code

1. MCP: copy [`integrations/claude-code/.mcp.json`](../../integrations/claude-code/.mcp.json) to your
   repository root (it reads `DECISIONLOOP_AGENT_KEY` from the environment).
2. Hooks (optional, recommended): merge [`integrations/claude-code/settings.json`](../../integrations/claude-code/settings.json)
   into `.claude/settings.json`.

| Hook | What DecisionLoop does |
|---|---|
| `SessionStart` | Tells the agent DecisionLoop exists, lists decisions currently AT RISK, and gives context for uncommitted changes |
| `UserPromptSubmit` | Injects the decisions governing paths mentioned in the prompt and changed files — only when something is relevant |
| `PreToolUse` (Edit/Write) | Asks you before editing a file protected by a **BLOCKING** constraint; advisory constraints never interrupt |
| `Stop` | Post-flight: if dependencies or governed files changed, nudges the agent to propose any real decision it made (once per change set) |

Hooks never break the session: any failure (server down, timeout) exits silently.

## Claude Desktop and other chat clients

Copy [`integrations/claude-desktop/claude_desktop_config.json`](../../integrations/claude-desktop/claude_desktop_config.json)
into Claude Desktop's configuration and fill in the agent key. It runs `decisionloop mcp` (stdio), which calls
the HTTP API, so the client never holds database credentials. The wording the client sees comes from the
workspace's primary domain (`decisionloop init --profile support`).

## Your own agent

Use the TypeScript SDK (`@decisionloop/sdk`) or the HTTP API directly. A minimal agent that checks a
refund before issuing it is in
[`integrations/custom-agent/check-before-acting.ts`](../../integrations/custom-agent/check-before-acting.ts).

## Codex

Copy [`integrations/codex/config.toml`](../../integrations/codex/config.toml) into `~/.codex/config.toml`
(or `.codex/config.toml` in the repository). It uses `bearer_token_env_var = "DECISIONLOOP_AGENT_KEY"`.

## GitHub Copilot (VS Code)

Copy [`integrations/vscode-copilot/mcp.json`](../../integrations/vscode-copilot/mcp.json) to
`.vscode/mcp.json`. VS Code prompts for the key once and stores it as a secret (`"password": true`).

## Cursor

[`integrations/cursor/mcp.json`](../../integrations/cursor/mcp.json) → `.cursor/mcp.json`. The
`${env:…}` interpolation syntax is Cursor's; if your version doesn't support it, use the stdio form
(`"command": "decisionloop", "args": ["mcp"]`) with `DECISIONLOOP_AGENT_KEY` exported.

## What agents should do (the server tells them this too)

1. Before significant work, call `decisionloop_get_context` with the intent and the files, services or
   packages involved.
2. Respect returned constraints. To reverse a decision, say so to the user and propose the change.
3. After making a decision that will shape future work, call `decisionloop_propose_decision` with the
   rejected alternatives and structured assumptions. Don't propose routine changes.
4. Report observations that bear on recorded assumptions with `decisionloop_add_evidence` (benchmarks,
   incidents, changed requirements). Agent evidence can challenge an assumption; only stronger sources or
   a person can invalidate it.

## Tools

| Tool | Scope |
|---|---|
| `decisionloop_get_context`, `_search_decisions`, `_get_decision`, `_explain`, `_get_constraints`, `_list_at_risk`, `_get_conflicts`, `_blast_radius`, `_get_evidence_status` | read |
| `decisionloop_check_action` (only when the workspace's domain enables it; see [domains](domains.md)) | read |
| `decisionloop_propose_decision`, `_propose_assumption`, `_add_evidence`, `_record_outcome` | propose |
| `decisionloop_commit_decision`, `_accept_conflict`, `_dismiss_conflict`, `_supersede_decision` | people with write scope only |
