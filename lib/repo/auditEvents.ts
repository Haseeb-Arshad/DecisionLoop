import { sql, toJsonValue } from "@/db/client";
import type { AuditEvent } from "@/lib/types";

function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    actorUserId: (row.actor_user_id as string) ?? null,
    actorLabel: (row.actor_label as string) ?? null,
    action: row.action as string,
    entityType: (row.entity_type as string) ?? null,
    entityId: (row.entity_id as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Every mutating action funnels through here — see docs/architecture.md §7. */
export async function recordAuditEvent(input: {
  tenantId: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AuditEvent> {
  const [row] = await sql`
    INSERT INTO audit_events (
      tenant_id, actor_user_id, actor_label, action, entity_type, entity_id, metadata
    ) VALUES (
      ${input.tenantId}, ${input.actorUserId ?? null},
      ${input.actorLabel ?? (input.actorUserId ? null : "system")},
      ${input.action}, ${input.entityType ?? null}, ${input.entityId ?? null},
      ${input.metadata ? sql.json(toJsonValue(input.metadata)) : null}
    )
    RETURNING *
  `;
  return mapAudit(row!);
}

export async function listRecentAuditEvents(
  tenantId: string,
  limit = 50,
): Promise<AuditEvent[]> {
  const rows = await sql`
    SELECT * FROM audit_events
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAudit);
}
