import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { childLogger } from "@/lib/logger";
import type { McpVerification } from "@/lib/types";

const log = childLogger({ module: "cockroachMcp" });

/**
 * Real client for CockroachDB Cloud's Managed MCP Server
 * (https://cockroachlabs.cloud/mcp). This server is designed for AI dev
 * tools (Claude Code, Cursor), not application runtime traffic — so it is
 * deliberately NOT on the hot path for ordinary reads/writes; the app's own
 * postgres.js pool (db/client.ts) does that. It's used for exactly one
 * thing: the Memory Inspector's "independently verify via CockroachDB's own
 * MCP tools" panel — proving, through a second, Anthropic-facing channel,
 * that the rows a memory_trace claims to have used really are in
 * CockroachDB, with the values it claims.
 *
 * Auth: a service-account API key (Cloud RBAC, scoped to this cluster with
 * `mcp:read`), sent as a Bearer token — the "fully autonomous environment"
 * auth path CockroachDB's docs describe, as opposed to the OAuth 2.1 +
 * PKCE flow meant for interactive human sessions.
 */

function isConfigured(): boolean {
  return Boolean(process.env.COCKROACHDB_MCP_SERVICE_KEY);
}

async function withMcpClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const url = process.env.COCKROACHDB_MCP_URL ?? "https://cockroachlabs.cloud/mcp";
  const apiKey = process.env.COCKROACHDB_MCP_SERVICE_KEY;
  if (!apiKey) {
    throw new Error("COCKROACHDB_MCP_SERVICE_KEY is not set.");
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  });

  const client = new Client({ name: "decisionloop-memory-inspector", version: "0.1.0" });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Independently re-runs a read-only SELECT against CockroachDB via the
 * Managed MCP Server's `select_query` tool, and reports what came back.
 * Used to cross-check that specific memory_chunk rows a trace claims to have
 * used are real, current CockroachDB data — not something the app
 * fabricated in its own response.
 */
export async function verifyRowsViaMcp(
  chunkIds: string[],
): Promise<McpVerification> {
  if (chunkIds.length === 0) {
    return { verified: true, toolCalls: [], rawRows: [] };
  }

  if (!isConfigured()) {
    return {
      verified: false,
      toolCalls: [],
      rawRows: [],
      error:
        "COCKROACHDB_MCP_SERVICE_KEY is not configured — MCP cross-check unavailable. " +
        "The internal trace above is still real CockroachDB data; this panel only adds a " +
        "second, independent verification path.",
    };
  }

  // chunkIds always come from our own memory_traces rows (never client input
  // directly), but this string gets interpolated into SQL text handed to an
  // external MCP server rather than passed as a bind parameter — the MCP
  // protocol's select_query tool takes a single SQL string, not a
  // parameterized query. Validate the shape defensively before building it.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = chunkIds.filter((id) => uuidPattern.test(id));
  if (validIds.length !== chunkIds.length) {
    log.warn({ chunkIds }, "verifyRowsViaMcp received non-UUID chunk ids — dropping them");
  }
  if (validIds.length === 0) {
    return { verified: true, toolCalls: [], rawRows: [] };
  }

  try {
    return await withMcpClient(async (client) => {
      const query =
        `SELECT id, source_type, source_id, decision_id, left(content, 200) AS content_preview ` +
        `FROM memory_chunks WHERE id IN (${validIds.map((id) => `'${id}'`).join(", ")})`;

      const result = await client.callTool({
        name: "select_query",
        arguments: { sql: query },
      });

      const rawRows = Array.isArray(result.content) ? result.content : [result.content];

      return {
        verified: true,
        toolCalls: [{ tool: "select_query", input: { sql: query }, output: rawRows }],
        rawRows,
      };
    });
  } catch (err) {
    log.warn({ err }, "CockroachDB MCP verification failed");
    return {
      verified: false,
      toolCalls: [],
      rawRows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Lists the memory_chunks table schema straight from CockroachDB via MCP — used on the Memory Inspector's "prove this is real" panel. */
export async function getMemorySchemaViaMcp(): Promise<McpVerification> {
  if (!isConfigured()) {
    return {
      verified: false,
      toolCalls: [],
      rawRows: [],
      error: "COCKROACHDB_MCP_SERVICE_KEY is not configured.",
    };
  }

  try {
    return await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "get_table_schema",
        arguments: { database: "defaultdb", table: "memory_chunks" },
      });
      const rawRows = Array.isArray(result.content) ? result.content : [result.content];
      return {
        verified: true,
        toolCalls: [{ tool: "get_table_schema", input: { table: "memory_chunks" }, output: rawRows }],
        rawRows,
      };
    });
  } catch (err) {
    log.warn({ err }, "CockroachDB MCP schema lookup failed");
    return {
      verified: false,
      toolCalls: [],
      rawRows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const mcpConfigured = isConfigured;
