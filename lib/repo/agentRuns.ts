import { sql, toJsonValue } from "@/db/client";
import type {
  AgentIntent,
  AgentRun,
  AgentRunStatus,
  MemorySourceType,
  ObservabilityMetrics,
  RetrievalEvent,
  ScoredMemoryCandidate,
} from "@/lib/types";

function mapRun(row: Record<string, unknown>): AgentRun {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: (row.project_id as string) ?? null,
    sessionId: row.session_id as string,
    request: (row.request as string) ?? null,
    intent: row.intent as AgentIntent,
    model: (row.model as string) ?? null,
    status: row.status as AgentRunStatus,
    startedAt: (row.started_at as Date).toISOString(),
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    retrievalLatencyMs:
      row.retrieval_latency_ms === null ? null : Number(row.retrieval_latency_ms),
    memoriesRetrieved: Number(row.memories_retrieved),
    memoriesWritten: Number(row.memories_written),
    conflictsDetected: Number(row.conflicts_detected),
    tokenUsage: (row.token_usage as Record<string, unknown>) ?? null,
    outputSummary: (row.output_summary as string) ?? null,
    error: (row.error as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
  };
}

function mapRetrievalEvent(row: Record<string, unknown>): RetrievalEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentRunId: (row.agent_run_id as string) ?? null,
    memoryTraceId: (row.memory_trace_id as string) ?? null,
    memoryType: row.memory_type as MemorySourceType,
    memoryId: row.memory_id as string,
    memoryChunkId: (row.memory_chunk_id as string) ?? null,
    similarityScore: Number(row.similarity_score),
    importanceScore: Number(row.importance_score),
    authorityScore: Number(row.authority_score),
    contextualScore: Number(row.contextual_score),
    finalScore: Number(row.final_score),
    selectedForContext: row.selected_for_context as boolean,
    crossSession: row.cross_session as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function startAgentRun(input: {
  tenantId: string;
  projectId?: string | null;
  sessionId: string;
  request?: string | null;
  intent: AgentIntent;
  model?: string | null;
  createdBy?: string | null;
}): Promise<AgentRun> {
  const [row] = await sql`
    INSERT INTO agent_runs (
      tenant_id, project_id, session_id, request, intent, model, created_by
    ) VALUES (
      ${input.tenantId}, ${input.projectId ?? null}, ${input.sessionId},
      ${input.request ?? null}, ${input.intent}, ${input.model ?? null},
      ${input.createdBy ?? null}
    )
    RETURNING *
  `;
  return mapRun(row!);
}

export async function completeAgentRun(
  runId: string,
  input: {
    status: AgentRunStatus;
    latencyMs: number;
    retrievalLatencyMs?: number | null;
    memoriesRetrieved?: number;
    memoriesWritten?: number;
    conflictsDetected?: number;
    tokenUsage?: Record<string, unknown> | null;
    outputSummary?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await sql`
    UPDATE agent_runs SET
      status = ${input.status},
      completed_at = now(),
      latency_ms = ${input.latencyMs},
      retrieval_latency_ms = ${input.retrievalLatencyMs ?? null},
      memories_retrieved = ${input.memoriesRetrieved ?? 0},
      memories_written = ${input.memoriesWritten ?? 0},
      conflicts_detected = ${input.conflictsDetected ?? 0},
      token_usage = ${input.tokenUsage ? sql.json(toJsonValue(input.tokenUsage)) : null},
      output_summary = ${input.outputSummary ?? null},
      error = ${input.error ?? null}
    WHERE id = ${runId}
  `;
}

export async function getAgentRunById(
  tenantId: string,
  runId: string,
): Promise<AgentRun | null> {
  const [row] = await sql`
    SELECT * FROM agent_runs WHERE id = ${runId} AND tenant_id = ${tenantId}
  `;
  return row ? mapRun(row) : null;
}

export async function listAgentRuns(
  tenantId: string,
  limit = 50,
): Promise<AgentRun[]> {
  const rows = await sql`
    SELECT * FROM agent_runs
    WHERE tenant_id = ${tenantId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRun);
}

/**
 * Writes one row per scored candidate. These are the real numbers the
 * Memory Inspector displays — §23 is explicit that retrieval scores must
 * never be fabricated, so every score shown in the UI is read back from
 * here or from the trace snapshot written in the same transaction-less
 * sequence.
 */
export async function recordRetrievalEvents(input: {
  tenantId: string;
  agentRunId: string | null;
  memoryTraceId: string | null;
  candidates: ScoredMemoryCandidate[];
}): Promise<void> {
  if (input.candidates.length === 0) return;

  await Promise.all(
    input.candidates.map(
      (c) => sql`
        INSERT INTO retrieval_events (
          tenant_id, agent_run_id, memory_trace_id, memory_type, memory_id,
          memory_chunk_id, similarity_score, importance_score, authority_score,
          contextual_score, final_score, selected_for_context, cross_session
        ) VALUES (
          ${input.tenantId}, ${input.agentRunId}, ${input.memoryTraceId},
          ${c.sourceType}, ${c.sourceId}, ${c.chunkId},
          ${c.semanticScore}, ${c.importanceScore}, ${c.authorityComponent},
          ${c.contextualScore}, ${c.finalScore}, ${c.selectedForContext},
          ${c.crossSession}
        )
      `,
    ),
  );
}

export async function listRetrievalEventsForRun(
  agentRunId: string,
): Promise<RetrievalEvent[]> {
  const rows = await sql`
    SELECT * FROM retrieval_events
    WHERE agent_run_id = ${agentRunId}
    ORDER BY final_score DESC
  `;
  return rows.map(mapRetrievalEvent);
}

/**
 * The §32 dashboard numbers, computed from real rows. Nothing here is
 * manufactured or estimated — a metric with no data returns 0 or null
 * rather than a plausible-looking placeholder.
 */
export async function getObservabilityMetrics(
  tenantId: string,
): Promise<ObservabilityMetrics> {
  const [row] = await sql`
    SELECT
      (SELECT count(*) FROM decisions
        WHERE tenant_id = ${tenantId} AND status IN ('ACTIVE', 'REOPENED')) AS active_decisions,
      (SELECT count(*) FROM decisions
        WHERE tenant_id = ${tenantId} AND status = 'AT_RISK') AS decisions_at_risk,
      (SELECT count(*) FROM assumptions a
        JOIN decisions d ON d.id = a.decision_id
        WHERE d.tenant_id = ${tenantId}) AS assumptions_tracked,
      (SELECT count(*) FROM assumptions a
        JOIN decisions d ON d.id = a.decision_id
        WHERE d.tenant_id = ${tenantId} AND a.validity_status = 'CHALLENGED') AS assumptions_challenged,
      (SELECT count(*) FROM conflict_events WHERE tenant_id = ${tenantId}) AS conflicts_detected,
      (SELECT count(*) FROM conflict_events
        WHERE tenant_id = ${tenantId} AND reviewed_at IS NULL) AS conflicts_unreviewed,
      (SELECT count(*) FROM retrieval_events
        WHERE tenant_id = ${tenantId} AND cross_session = true
          AND selected_for_context = true) AS cross_session_recalls,
      (SELECT count(*) FROM documents WHERE tenant_id = ${tenantId}) AS documents_ingested,
      (SELECT count(*) FROM memory_chunks WHERE tenant_id = ${tenantId}) AS memories_stored,
      (SELECT avg(retrieval_latency_ms) FROM agent_runs
        WHERE tenant_id = ${tenantId} AND retrieval_latency_ms IS NOT NULL) AS avg_retrieval_latency,
      (SELECT avg(latency_ms) FROM agent_runs
        WHERE tenant_id = ${tenantId} AND latency_ms IS NOT NULL) AS avg_agent_latency,
      (SELECT count(*) FROM agent_runs WHERE tenant_id = ${tenantId}) AS agent_runs,
      (SELECT count(*) FROM agent_runs
        WHERE tenant_id = ${tenantId} AND status = 'FAILED') AS agent_run_failures
  `;

  const r = row!;
  return {
    activeDecisions: Number(r.active_decisions),
    decisionsAtRisk: Number(r.decisions_at_risk),
    assumptionsTracked: Number(r.assumptions_tracked),
    assumptionsChallenged: Number(r.assumptions_challenged),
    conflictsDetected: Number(r.conflicts_detected),
    conflictsUnreviewed: Number(r.conflicts_unreviewed),
    crossSessionRecalls: Number(r.cross_session_recalls),
    documentsIngested: Number(r.documents_ingested),
    memoriesStored: Number(r.memories_stored),
    averageRetrievalLatencyMs:
      r.avg_retrieval_latency === null ? null : Math.round(Number(r.avg_retrieval_latency)),
    averageAgentLatencyMs:
      r.avg_agent_latency === null ? null : Math.round(Number(r.avg_agent_latency)),
    agentRuns: Number(r.agent_runs),
    agentRunFailures: Number(r.agent_run_failures),
  };
}
