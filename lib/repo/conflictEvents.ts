import { sql } from "@/db/client";
import type { ConflictEvent } from "@/lib/types";

function mapConflict(row: Record<string, unknown>): ConflictEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    assumptionId: row.assumption_id as string,
    documentId: (row.document_id as string) ?? null,
    factStatement: row.fact_statement as string,
    explanation: row.explanation as string,
    suggestedOptionId: (row.suggested_option_id as string) ?? null,
    memoryTraceId: (row.memory_trace_id as string) ?? null,
    detectedAt: (row.detected_at as Date).toISOString(),
  };
}

export async function createConflictEvent(input: {
  tenantId: string;
  decisionId: string;
  assumptionId: string;
  documentId?: string | null;
  factStatement: string;
  explanation: string;
  suggestedOptionId?: string | null;
  memoryTraceId?: string | null;
}): Promise<ConflictEvent> {
  const [row] = await sql`
    INSERT INTO conflict_events (
      tenant_id, decision_id, assumption_id, document_id,
      fact_statement, explanation, suggested_option_id, memory_trace_id
    ) VALUES (
      ${input.tenantId}, ${input.decisionId}, ${input.assumptionId},
      ${input.documentId ?? null}, ${input.factStatement}, ${input.explanation},
      ${input.suggestedOptionId ?? null}, ${input.memoryTraceId ?? null}
    )
    RETURNING *
  `;
  return mapConflict(row);
}

export async function listConflictEventsForDecision(
  decisionId: string,
): Promise<ConflictEvent[]> {
  const rows = await sql`
    SELECT * FROM conflict_events WHERE decision_id = ${decisionId} ORDER BY detected_at DESC
  `;
  return rows.map(mapConflict);
}

export async function listRecentConflictEvents(
  tenantId: string,
  limit = 20,
): Promise<ConflictEvent[]> {
  const rows = await sql`
    SELECT * FROM conflict_events
    WHERE tenant_id = ${tenantId}
    ORDER BY detected_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapConflict);
}
