import { sql, toJsonValue } from "@/db/client";
import type {
  McpVerification,
  MemoryTrace,
  MemoryTraceAction,
  ScoredMemoryCandidate,
  ScoringWeights,
} from "@/lib/types";

function mapTrace(row: Record<string, unknown>): MemoryTrace {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentRunId: (row.agent_run_id as string) ?? null,
    actionType: row.action_type as MemoryTraceAction,
    relatedDecisionId: (row.related_decision_id as string) ?? null,
    relatedDocumentId: (row.related_document_id as string) ?? null,
    queryText: (row.query_text as string) ?? null,
    renderedSql: (row.rendered_sql as string) ?? null,
    candidates: (row.candidates as ScoredMemoryCandidate[]) ?? [],
    usedChunkIds: (row.used_chunk_ids as string[]) ?? [],
    llmReasoning: (row.llm_reasoning as string) ?? null,
    retrievalLatencyMs:
      row.retrieval_latency_ms === null || row.retrieval_latency_ms === undefined
        ? null
        : Number(row.retrieval_latency_ms),
    scoringWeights: (row.scoring_weights as ScoringWeights) ?? null,
    mcpVerification: (row.mcp_verification as McpVerification) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * Writes one row to memory_traces per AI action that reads or acts on
 * memory. This table IS the Memory Inspector — every field here is rendered
 * directly in the UI (app/(app)/inspector) as proof of what CockroachDB
 * data drove a given action. Written unconditionally, even when an action
 * finds nothing noteworthy, so "why didn't anything happen" is answerable
 * too.
 *
 * Scores stored here are the real computed values from
 * lib/engine/retrieval.ts — §23 is explicit that retrieval scores must
 * never be fabricated. The same numbers are also written as normalized
 * retrieval_events rows (lib/repo/agentRuns.ts) for aggregate metrics; this
 * copy is the immutable provenance snapshot of one action.
 */
export async function recordMemoryTrace(input: {
  tenantId: string;
  agentRunId?: string | null;
  actionType: MemoryTraceAction;
  relatedDecisionId?: string | null;
  relatedDocumentId?: string | null;
  queryText?: string | null;
  renderedSql?: string | null;
  candidates?: ScoredMemoryCandidate[];
  usedChunkIds?: string[];
  llmReasoning?: string | null;
  retrievalLatencyMs?: number | null;
  scoringWeights?: ScoringWeights | null;
  mcpVerification?: McpVerification | null;
}): Promise<MemoryTrace> {
  const [row] = await sql`
    INSERT INTO memory_traces (
      tenant_id, agent_run_id, action_type, related_decision_id, related_document_id,
      query_text, rendered_sql, candidates, used_chunk_ids, llm_reasoning,
      retrieval_latency_ms, scoring_weights, mcp_verification
    ) VALUES (
      ${input.tenantId}, ${input.agentRunId ?? null}, ${input.actionType},
      ${input.relatedDecisionId ?? null}, ${input.relatedDocumentId ?? null},
      ${input.queryText ?? null}, ${input.renderedSql ?? null},
      ${sql.json(toJsonValue(input.candidates ?? []))},
      ${input.usedChunkIds ?? []},
      ${input.llmReasoning ?? null},
      ${input.retrievalLatencyMs ?? null},
      ${input.scoringWeights ? sql.json(toJsonValue(input.scoringWeights)) : null},
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
  opts: { decisionId?: string; agentRunId?: string; limit?: number } = {},
): Promise<MemoryTrace[]> {
  const rows = await sql`
    SELECT * FROM memory_traces
    WHERE tenant_id = ${tenantId}
      ${opts.decisionId ? sql`AND related_decision_id = ${opts.decisionId}` : sql``}
      ${opts.agentRunId ? sql`AND agent_run_id = ${opts.agentRunId}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 50}
  `;
  return rows.map(mapTrace);
}
