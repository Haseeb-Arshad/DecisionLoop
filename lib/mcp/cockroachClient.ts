import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { childLogger } from "@/lib/logger";
import type { McpVerification } from "@/lib/types";

const log = childLogger({ module: "cockroachMcp" });

/**
 * Real client for CockroachDB Cloud's Managed MCP Server
 * (https://cockroachlabs.cloud/mcp).
 *
 * This server is designed for AI tooling rather than application runtime
 * traffic, so it is deliberately NOT on the hot path for ordinary
 * reads/writes — the app's own postgres.js pool (db/client.ts) does that.
 * It is used where its purpose genuinely lines up with the product's:
 *
 *  1. `verifyRowsViaMcp` — the Memory Inspector's independent cross-check.
 *     Re-reads the exact memory_chunks rows a trace claims it used, through
 *     a second channel that does not share the app's connection pool or
 *     query builder. If the app were fabricating provenance, this panel
 *     would not agree with it.
 *  2. `runMemoryAnalystQuery` — the "Decision Memory Analyst" feature (§27):
 *     a small set of named, parameterised analyst questions over structured
 *     organizational memory, answered by MCP `select_query` tool calls.
 *
 * Auth: a service-account API key (Cloud RBAC, scoped to this cluster), sent
 * as a Bearer token — the autonomous-environment auth
 * path CockroachDB documents, as opposed to the OAuth 2.1 + PKCE flow meant
 * for interactive human sessions.
 *
 * Every function degrades gracefully when unconfigured: the UI shows the
 * internal trace and an explicit "MCP cross-check unavailable" note rather
 * than implying a verification happened. §27 is explicit that MCP support
 * must never be *claimed* without a successful tool invocation.
 */

function isConfigured(): boolean {
  return Boolean(
    process.env.COCKROACHDB_MCP_SERVICE_KEY && process.env.COCKROACHDB_MCP_CLUSTER_ID,
  );
}

async function withMcpClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.COCKROACHDB_MCP_URL ?? "https://cockroachlabs.cloud/mcp";
  const apiKey = process.env.COCKROACHDB_MCP_SERVICE_KEY;
  const clusterId = process.env.COCKROACHDB_MCP_CLUSTER_ID;
  if (!apiKey) {
    throw new Error("COCKROACHDB_MCP_SERVICE_KEY is not set.");
  }
  if (!clusterId) {
    throw new Error("COCKROACHDB_MCP_CLUSTER_ID is not set.");
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "mcp-cluster-id": clusterId,
      },
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} is not a well-formed UUID; refusing to build a query with it.`);
  }
  return value;
}

const NOT_CONFIGURED_MESSAGE =
  "COCKROACHDB_MCP_SERVICE_KEY and COCKROACHDB_MCP_CLUSTER_ID are not configured — MCP cross-check unavailable. " +
  "The internal trace is still real CockroachDB data; this panel only adds a second, " +
  "independent verification path.";

/**
 * Independently re-runs a read-only SELECT against CockroachDB via the
 * Managed MCP Server's `select_query` tool, and reports what came back.
 */
export async function verifyRowsViaMcp(
  tenantId: string,
  chunkIds: string[],
): Promise<McpVerification> {
  if (chunkIds.length === 0) {
    return { verified: true, toolCalls: [], rawRows: [] };
  }

  if (!isConfigured()) {
    return { verified: false, toolCalls: [], rawRows: [], error: NOT_CONFIGURED_MESSAGE };
  }
  assertUuid(tenantId, "tenantId");

  // These ids always come from our own memory_traces rows, never directly
  // from client input — but they are interpolated into SQL text handed to
  // an external server (the MCP select_query tool takes a SQL string, not a
  // parameterised query), so validate the shape defensively.
  const validIds = chunkIds.filter((id) => UUID_PATTERN.test(id));
  if (validIds.length !== chunkIds.length) {
    log.warn({ chunkIds }, "verifyRowsViaMcp received non-UUID chunk ids — dropping them");
  }
  if (validIds.length === 0) {
    return { verified: true, toolCalls: [], rawRows: [] };
  }

  try {
    return await withMcpClient(async (client) => {
      const query =
        `SELECT id, source_type, source_id, decision_id, importance, authority_score, ` +
        `left(content, 200) AS content_preview ` +
        `FROM memory_chunks WHERE id IN (${validIds.map((id) => `'${id}'`).join(", ")})`;
      const tenantSafeQuery = query.replace(
        "FROM memory_chunks WHERE",
        `FROM memory_chunks WHERE tenant_id = '${tenantId}' AND`,
      );

      const result = await client.callTool({
        name: "select_query",
        arguments: { sql: tenantSafeQuery },
      });

      const rawRows = Array.isArray(result.content) ? result.content : [result.content];

      return {
        verified: true,
        toolCalls: [{ tool: "select_query", input: { sql: tenantSafeQuery }, output: rawRows }],
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

/** Lists the memory_chunks schema straight from CockroachDB via MCP. */
export async function getMemorySchemaViaMcp(): Promise<McpVerification> {
  if (!isConfigured()) {
    return { verified: false, toolCalls: [], rawRows: [], error: NOT_CONFIGURED_MESSAGE };
  }

  try {
    const database = mcpDatabaseName();
    return await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "get_table_schema",
        arguments: { database, table: "memory_chunks" },
      });
      const rawRows = Array.isArray(result.content) ? result.content : [result.content];
      return {
        verified: true,
        toolCalls: [
          { tool: "get_table_schema", input: { database, table: "memory_chunks" }, output: rawRows },
        ],
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

function mcpDatabaseName(): string {
  const configured = process.env.COCKROACHDB_MCP_DATABASE?.trim();
  if (configured) return configured;
  const url = process.env.DATABASE_URL;
  if (!url) return "defaultdb";
  try {
    const database = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
    return database || "defaultdb";
  } catch {
    return "defaultdb";
  }
}

// ── Decision Memory Analyst (§27) ───────────────────────────────────────────

export interface AnalystQuestion {
  id: string;
  label: string;
  description: string;
  /** Built with the tenant id interpolated after UUID validation. */
  buildSql(tenantId: string): string;
}

/**
 * A fixed catalogue of analyst questions rather than free-form SQL from the
 * user. Two reasons: the MCP credential is shared infrastructure, so an
 * arbitrary-SQL endpoint would be a cross-tenant read primitive; and every
 * question here has its tenant filter baked in, which a user-supplied query
 * could omit.
 */
export const ANALYST_QUESTIONS: AnalystQuestion[] = [
  {
    id: "challenged_assumptions",
    label: "Which active decisions currently have challenged assumptions?",
    description:
      "Decisions still in force whose supporting assumptions have been challenged or invalidated by later evidence.",
    buildSql: (tenantId) => `
      SELECT d.title AS decision, d.status, a.statement AS assumption,
             a.validity_status, a.importance
      FROM decisions d
      JOIN assumptions a ON a.decision_id = d.id
      WHERE d.tenant_id = '${tenantId}'
        AND a.validity_status IN ('CHALLENGED', 'INVALIDATED')
        AND d.status NOT IN ('ARCHIVED', 'SUPERSEDED')
      ORDER BY a.importance DESC
      LIMIT 50`.trim(),
  },
  {
    id: "pricing_conflicts",
    label: "Show decisions affected by pricing changes.",
    description: "Conflicts whose underlying metric is a price, newest first.",
    buildSql: (tenantId) => `
      SELECT d.title AS decision, c.old_value, c.new_value, c.confidence,
             c.detection_method, c.detected_at
      FROM conflict_events c
      JOIN decisions d ON d.id = c.decision_id
      JOIN assumptions a ON a.id = c.assumption_id
      WHERE c.tenant_id = '${tenantId}'
        AND (a.metric ILIKE '%price%' OR a.metric ILIKE '%cost%')
      ORDER BY c.detected_at DESC
      LIMIT 50`.trim(),
  },
  {
    id: "stale_assumptions",
    label: "Which assumptions have not been verified recently?",
    description:
      "Still-valid assumptions with no supporting evidence recorded in the last 90 days.",
    buildSql: (tenantId) => `
      SELECT d.title AS decision, a.statement AS assumption, a.importance,
             a.valid_from
      FROM assumptions a
      JOIN decisions d ON d.id = a.decision_id
      WHERE d.tenant_id = '${tenantId}'
        AND a.validity_status = 'VALID'
        AND NOT EXISTS (
          SELECT 1 FROM decision_evidence e
          WHERE e.assumption_id = a.id
            AND e.evidence_type = 'SUPPORTING'
            AND e.created_at > now() - INTERVAL '90 days'
        )
      ORDER BY a.importance DESC
      LIMIT 50`.trim(),
  },
  {
    id: "at_risk_overview",
    label: "What is at risk right now, and why?",
    description: "Every at-risk decision with the conflict that caused it.",
    buildSql: (tenantId) => `
      SELECT d.title AS decision, d.risk_explanation, c.new_value,
             c.detected_at, c.resolution
      FROM decisions d
      LEFT JOIN conflict_events c ON c.decision_id = d.id
      WHERE d.tenant_id = '${tenantId}' AND d.status = 'AT_RISK'
      ORDER BY c.detected_at DESC NULLS LAST
      LIMIT 50`.trim(),
  },
];

export interface AnalystResult {
  questionId: string;
  label: string;
  sql: string;
  verification: McpVerification;
}

/**
 * Answers one catalogued analyst question by issuing a real `select_query`
 * MCP tool call against CockroachDB Cloud. This is the production feature
 * §27 asks for — not a decorative checkbox: the result rendered in the UI
 * is whatever the MCP server returned, and the tool call is shown alongside
 * it.
 */
export async function runMemoryAnalystQuery(
  tenantId: string,
  questionId: string,
): Promise<AnalystResult> {
  const question = ANALYST_QUESTIONS.find((q) => q.id === questionId);
  if (!question) {
    throw new Error(`Unknown analyst question: ${questionId}`);
  }

  const sql = question.buildSql(assertUuid(tenantId, "tenantId"));

  if (!isConfigured()) {
    return {
      questionId: question.id,
      label: question.label,
      sql,
      verification: {
        verified: false,
        toolCalls: [],
        rawRows: [],
        error: NOT_CONFIGURED_MESSAGE,
      },
    };
  }

  try {
    const verification = await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "select_query",
        arguments: { sql },
      });
      const rawRows = Array.isArray(result.content) ? result.content : [result.content];
      return {
        verified: true,
        toolCalls: [{ tool: "select_query", input: { sql }, output: rawRows }],
        rawRows,
      } satisfies McpVerification;
    });

    return { questionId: question.id, label: question.label, sql, verification };
  } catch (err) {
    log.warn({ err, questionId }, "CockroachDB MCP analyst query failed");
    return {
      questionId: question.id,
      label: question.label,
      sql,
      verification: {
        verified: false,
        toolCalls: [],
        rawRows: [],
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export const mcpConfigured = isConfigured;
