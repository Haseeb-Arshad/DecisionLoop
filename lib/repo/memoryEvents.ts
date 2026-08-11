import { sql, toJsonValue } from "@/db/client";
import type {
  ActorType,
  MemoryEntityType,
  MemoryEvent,
  MemoryEventType,
} from "@/lib/types";

function mapEvent(row: Record<string, unknown>): MemoryEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: (row.project_id as string) ?? null,
    entityType: row.entity_type as MemoryEntityType,
    entityId: row.entity_id as string,
    decisionId: (row.decision_id as string) ?? null,
    eventType: row.event_type as MemoryEventType,
    agentRunId: (row.agent_run_id as string) ?? null,
    actorType: row.actor_type as ActorType,
    actorUserId: (row.actor_user_id as string) ?? null,
    summary: (row.summary as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * Append-only memory trail (decision.md §14). This is what the decision
 * timeline (§24) renders — every entry is a real recorded event, never a
 * reconstruction. Distinct from audit_events, which records operator
 * actions against the system rather than the life of a memory.
 */
export async function recordMemoryEvent(input: {
  tenantId: string;
  projectId?: string | null;
  entityType: MemoryEntityType;
  entityId: string;
  decisionId?: string | null;
  eventType: MemoryEventType;
  agentRunId?: string | null;
  actorType?: ActorType;
  actorUserId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<MemoryEvent> {
  const [row] = await sql`
    INSERT INTO memory_events (
      tenant_id, project_id, entity_type, entity_id, decision_id, event_type,
      agent_run_id, actor_type, actor_user_id, summary, metadata
    ) VALUES (
      ${input.tenantId}, ${input.projectId ?? null}, ${input.entityType},
      ${input.entityId}, ${input.decisionId ?? null}, ${input.eventType},
      ${input.agentRunId ?? null}, ${input.actorType ?? "SYSTEM"},
      ${input.actorUserId ?? null}, ${input.summary ?? null},
      ${input.metadata ? sql.json(toJsonValue(input.metadata)) : null}
    )
    RETURNING *
  `;
  return mapEvent(row!);
}

export async function listMemoryEventsForDecision(
  tenantId: string,
  decisionId: string,
): Promise<MemoryEvent[]> {
  const rows = await sql`
    SELECT * FROM memory_events
    WHERE tenant_id = ${tenantId} AND decision_id = ${decisionId}
    ORDER BY created_at ASC
  `;
  return rows.map(mapEvent);
}

export async function listRecentMemoryEvents(
  tenantId: string,
  limit = 25,
): Promise<MemoryEvent[]> {
  const rows = await sql`
    SELECT * FROM memory_events
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapEvent);
}
