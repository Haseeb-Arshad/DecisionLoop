# Agent and tool integrations

| Client | File | Where it goes |
|---|---|---|
| Claude Code (MCP) | [`claude-code/.mcp.json`](claude-code/.mcp.json) | repository root |
| Claude Code (hooks) | [`claude-code/settings.json`](claude-code/settings.json) | merge into `.claude/settings.json` |
| Codex | [`codex/config.toml`](codex/config.toml) | `~/.codex/config.toml` or `.codex/config.toml` |
| GitHub Copilot (VS Code) | [`vscode-copilot/mcp.json`](vscode-copilot/mcp.json) | `.vscode/mcp.json` |
| Cursor | [`cursor/mcp.json`](cursor/mcp.json) | `.cursor/mcp.json` |
| Any MCP client | `decisionloop mcp` (stdio) or `POST /mcp` (streamable HTTP) | — |

All of them authenticate with an **agent** key (read + propose). See [docs/v2/agents.md](../docs/v2/agents.md).

Provider-specific code lives here and in `packages/cli/src/hooks.ts`; `@decisionloop/core` knows nothing
about any particular agent.
