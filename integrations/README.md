# Agent and tool integrations

| Client | File | Where it goes |
|---|---|---|
| Claude Code (MCP) | [`claude-code/.mcp.json`](claude-code/.mcp.json) | repository root |
| Claude Code (hooks) | [`claude-code/settings.json`](claude-code/settings.json) | merge into `.claude/settings.json` |
| Claude Desktop | [`claude-desktop/claude_desktop_config.json`](claude-desktop/claude_desktop_config.json) | Claude Desktop's config file |
| Codex | [`codex/config.toml`](codex/config.toml) | `~/.codex/config.toml` or `.codex/config.toml` |
| GitHub Copilot (VS Code) | [`vscode-copilot/mcp.json`](vscode-copilot/mcp.json) | `.vscode/mcp.json` |
| Cursor | [`cursor/mcp.json`](cursor/mcp.json) | `.cursor/mcp.json` |
| Your own agent (any framework) | [`custom-agent/check-before-acting.ts`](custom-agent/check-before-acting.ts) | your code, using `@decisionloop/sdk` |
| Any MCP client | `decisionloop mcp` (stdio) or `POST /mcp` (streamable HTTP) | - |
| Source systems (ERP, billing, helpdesk) | `POST /api/v1/events` with a source-bound key | see [domains](../docs/v2/domains.md) |

All agents authenticate with an **agent** key (read + propose). Source systems use an **integration** key
bound to one source. See [docs/v2/agents.md](../docs/v2/agents.md) and [docs/v2/domains.md](../docs/v2/domains.md).

Provider-specific code lives here and in `packages/cli/src/hooks.ts`; `@decisionloop/core` knows nothing
about any particular agent.
