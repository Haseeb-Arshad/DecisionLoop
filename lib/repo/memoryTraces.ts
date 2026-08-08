import { sql, toJsonValue } from "@/db/client";
import type {
  McpVerification,
  MemoryChunkCandidate,
  MemoryTrace,
  MemoryTraceAction,
} from "@/lib/types";

function mapTrace(row: Record<string, unknown>): MemoryTrace {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    actionType: row.action_type as MemoryTraceAction,
    relatedDecisionId: (row.related_decision_id as string) ?? null,
    relatedDocumentId: (row.related_document_id as string) ?? null,
    queryText: (row.query_text as string) ?? null,
    renderedSql: (row.rendered_sql as string) ?? null,
    candidates: (row.candidates as MemoryChunkCandidate[]) ?? [],
    usedChunkIds: (row.used_chunk_ids as string[]) ?? [],
    llmReasoning: (row.llm_reasoning as string) ?? null,
    mcpVerification: (row.mcp_verification as McpVerification) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * Writes one row to memory_traces per AI action that reads or acts on
 * memory. This table IS the Memory Inspector — every field here is rendered
 * directly in the UI (app/(app)/inspector) as proof of what CockroachDB data
 * drove a given action. Written unconditionally, even when an action finds
 * nothing noteworthy, so "why didn't anything happen" is answerable too.
 */
export async function recordMemoryTrace(input: {
  tenantId: string;
  actionType: MemoryTraceAction;
  relatedDecisionId?: string | null;
  relatedDocumentId?: string | null;
  queryText?: string | null;
  renderedSql?: string | null;
  candidates?: MemoryChunkCandidate[];
  usedChunkIds?: string[];
  llmReasoning?: string | null;
  mcpVerification?: McpVerification | null;
}): Promise<MemoryTrace> {
  const [row] = await sql`
    INSERT INTO memory_traces (
      tenant_id, action_type, related_decision_id, related_document_id,
      query_text, rendered_sql, candidates, used_chunk_ids, llm_reasoning, mcp_verification
    ) VALUES (
      ${input.tenantId}, ${input.actionType},
      ${input.relatedDecisionId ?? null}, ${input.relatedDocumentId ?? null},
      ${input.queryText ?? null}, ${input.renderedSql ?? null},
      ${sql.json(toJsonValue(input.candidates ?? []))},
      ${input.usedChunkIds ?? []},
      ${input.llmReasoning ?? null},
      ${input.mcpVerification ? sql.json(toJsonValue(input.mcpVerification)) : null}
    )
    RETURNING *
  `;
  return mapTrace(row!);
}

export async function attachMcpVerification(
  traceId: string,
  verification: McpVerification,
): Promise<void> {
  await sql`
    UPDATE memory_traces SET mcp_verification = ${sql.json(toJsonValue(verification))}
    WHERE id = ${traceId}
  `;
}

export async function getMemoryTraceById(
  tenantId: string,
  traceId: string,
): Promise<MemoryTrace | null> {
  const [row] = await sql`
    SELECT * FROM memory_traces WHERE id = ${traceId} AND tenant_id = ${tenantId}
  `;
  return row ? mapTrace(row) : null;
}

export async function listMemoryTraces(
  tenantId: string,
  opts: { decisionId?: string; limit?: number } = {},
): Promise<MemoryTrace[]> {
  const limit = opts.limit ?? 50;
  const rows = opts.decisionId
    ? await sql`
        SELECT * FROM memory_traces
        WHERE tenant_id = ${tenantId} AND related_decision_id = ${opts.decisionId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT * FROM memory_traces
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map(mapTrace);
}
