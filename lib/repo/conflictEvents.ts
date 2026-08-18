import { sql } from "@/db/client";
import type {
  ConflictEvent,
  ConflictResolution,
  ConflictType,
  DetectionMethod,
  EvidenceRelation,
} from "@/lib/types";

function mapConflict(row: Record<string, unknown>): ConflictEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    assumptionId: row.assumption_id as string,
    documentId: (row.document_id as string) ?? null,
    memoryChunkId: (row.memory_chunk_id as string) ?? null,
    agentRunId: (row.agent_run_id as string) ?? null,
    factStatement: row.fact_statement as string,
    explanation: row.explanation as string,
    conflictType: (row.conflict_type as ConflictType) ?? "EVIDENCE_CONTRADICTS",
    relation: (row.relation as EvidenceRelation) ?? "CONTRADICTS",
    confidence: Number(row.confidence ?? 0.8),
    oldValue: (row.old_value as string) ?? null,
    newValue: (row.new_value as string) ?? null,
    sourceQuote: (row.source_quote as string) ?? null,
    detectionMethod: (row.detection_method as DetectionMethod) ?? "DETERMINISTIC",
    suggestedOptionId: (row.suggested_option_id as string) ?? null,
    memoryTraceId: (row.memory_trace_id as string) ?? null,
    reviewedAt: row.reviewed_at ? (row.reviewed_at as Date).toISOString() : null,
    resolution: (row.resolution as ConflictResolution) ?? null,
    resolvedBy: (row.resolved_by as string) ?? null,
    detectedAt: (row.detected_at as Date).toISOString(),
  };
}

export async function createConflictEvent(input: {
  tenantId: string;
  decisionId: string;
  assumptionId: string;
  documentId?: string | null;
  memoryChunkId?: string | null;
  agentRunId?: string | null;
  factStatement: string;
  explanation: string;
  conflictType: ConflictType;
  relation: EvidenceRelation;
  confidence: number;
  oldValue?: string | null;
  newValue?: string | null;
  sourceQuote?: string | null;
  detectionMethod: DetectionMethod;
  suggestedOptionId?: string | null;
  memoryTraceId?: string | null;
}): Promise<ConflictEvent> {
  const [decision] = await sql`
    SELECT project_id FROM decisions
    WHERE id = ${input.decisionId} AND tenant_id = ${input.tenantId}
  `;
  if (!decision) throw new Error("Decision not found in this workspace.");

  const [assumption] = await sql`
    SELECT a.id
    FROM assumptions a
    JOIN decisions d ON d.id = a.decision_id
    WHERE a.id = ${input.assumptionId}
      AND a.decision_id = ${input.decisionId}
      AND d.tenant_id = ${input.tenantId}
  `;
  if (!assumption) throw new Error("Assumption not found for this decision.");

  if (input.documentId) {
    const [document] = await sql`
      SELECT project_id FROM documents
      WHERE id = ${input.documentId} AND tenant_id = ${input.tenantId}
    `;
    if (!document) throw new Error("Document not found in this workspace.");
    if ((document.project_id as string | null) !== (decision.project_id as string | null)) {
      throw new Error("Conflict document does not belong to the decision project.");
    }
  }

  if (input.memoryChunkId) {
    const [chunk] = await sql`
      SELECT id
      FROM memory_chunks
      WHERE id = ${input.memoryChunkId}
        AND tenant_id = ${input.tenantId}
        AND source_type = 'document'
        ${input.documentId ? sql`AND source_id = ${input.documentId}` : sql``}
    `;
    if (!chunk) throw new Error("Conflict memory chunk not found in this workspace.");
  }

  if (input.agentRunId) {
    const [run] = await sql`
      SELECT id FROM agent_runs
      WHERE id = ${input.agentRunId} AND tenant_id = ${input.tenantId}
    `;
    if (!run) throw new Error("Conflict agent run not found in this workspace.");
  }

  if (input.suggestedOptionId) {
    const [option] = await sql`
      SELECT o.id
      FROM decision_options o
      JOIN decisions d ON d.id = o.decision_id
      WHERE o.id = ${input.suggestedOptionId}
        AND o.decision_id = ${input.decisionId}
        AND d.tenant_id = ${input.tenantId}
    `;
    if (!option) throw new Error("Suggested option not found for this decision.");
  }

  if (input.memoryTraceId) {
    const [trace] = await sql`
      SELECT id
      FROM memory_traces
      WHERE id = ${input.memoryTraceId}
        AND tenant_id = ${input.tenantId}
        AND (related_decision_id = ${input.decisionId} OR related_decision_id IS NULL)
    `;
    if (!trace) throw new Error("Memory trace not found for this decision.");
  }

  const [row] = await sql`
    INSERT INTO conflict_events (
      tenant_id, decision_id, assumption_id, document_id, memory_chunk_id,
      agent_run_id, fact_statement, explanation, conflict_type, relation,
      confidence, old_value, new_value, source_quote, detection_method,
      suggested_option_id, memory_trace_id
    ) VALUES (
      ${input.tenantId}, ${input.decisionId}, ${input.assumptionId},
      ${input.documentId ?? null}, ${input.memoryChunkId ?? null},
      ${input.agentRunId ?? null}, ${input.factStatement}, ${input.explanation},
      ${input.conflictType}, ${input.relation}, ${input.confidence},
      ${input.oldValue ?? null}, ${input.newValue ?? null},
      ${input.sourceQuote ?? null}, ${input.detectionMethod},
      ${input.suggestedOptionId ?? null}, ${input.memoryTraceId ?? null}
    )
    RETURNING *
  `;
  return mapConflict(row!);
}

/**
 * Guards against the same document raising the same conflict twice — e.g.
 * a re-uploaded pricing sheet, or a retry after a partial failure (§72:
 * "can duplicate documents create duplicate conflicts?").
 */
export async function findExistingConflict(
  tenantId: string,
  assumptionId: string,
  documentId: string | null,
  decisionId?: string,
): Promise<ConflictEvent | null> {
  const [row] = await sql`
    SELECT * FROM conflict_events
    WHERE tenant_id = ${tenantId}
      AND assumption_id = ${assumptionId}
      ${documentId ? sql`AND document_id = ${documentId}` : sql`AND document_id IS NULL`}
      ${decisionId ? sql`AND decision_id = ${decisionId}` : sql``}
    LIMIT 1
  `;
  return row ? mapConflict(row) : null;
}

export async function getConflictById(
  tenantId: string,
  conflictId: string,
): Promise<ConflictEvent | null> {
  const [row] = await sql`
    SELECT * FROM conflict_events WHERE id = ${conflictId} AND tenant_id = ${tenantId}
  `;
  return row ? mapConflict(row) : null;
}

export async function resolveConflict(
  tenantId: string,
  conflictId: string,
  resolution: ConflictResolution,
  resolvedBy: string,
): Promise<ConflictEvent> {
  const [row] = await sql`
    UPDATE conflict_events
    SET resolution = ${resolution}, resolved_by = ${resolvedBy}, reviewed_at = now()
    WHERE id = ${conflictId} AND tenant_id = ${tenantId}
    RETURNING *
  `;
  if (!row) throw new Error(`Conflict ${conflictId} not found in tenant ${tenantId}.`);
  return mapConflict(row);
}

export async function listConflictEventsForDecision(
  tenantId: string,
  decisionId: string,
): Promise<ConflictEvent[]> {
  const rows = await sql`
    SELECT * FROM conflict_events
    WHERE tenant_id = ${tenantId} AND decision_id = ${decisionId}
    ORDER BY detected_at DESC
  `;
  return rows.map(mapConflict);
}

export async function listRecentConflictEvents(
  tenantId: string,
  opts: { limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ConflictEvent[]> {
  const rows = await sql`
    SELECT * FROM conflict_events
    WHERE tenant_id = ${tenantId}
      ${opts.unresolvedOnly ? sql`AND resolution IS NULL` : sql``}
    ORDER BY detected_at DESC
    LIMIT ${opts.limit ?? 20}
  `;
  return rows.map(mapConflict);
}
