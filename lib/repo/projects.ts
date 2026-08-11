import { sql } from "@/db/client";
import type { Project, ProjectWithCounts } from "@/lib/types";

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    archivedAt: row.archived_at ? (row.archived_at as Date).toISOString() : null,
  };
}

export async function createProject(input: {
  tenantId: string;
  name: string;
  description?: string | null;
  createdBy?: string | null;
}): Promise<Project> {
  const [row] = await sql`
    INSERT INTO projects (tenant_id, name, description, created_by)
    VALUES (${input.tenantId}, ${input.name}, ${input.description ?? null}, ${input.createdBy ?? null})
    RETURNING *
  `;
  return mapProject(row!);
}

export async function getProjectById(
  tenantId: string,
  projectId: string,
): Promise<Project | null> {
  const [row] = await sql`
    SELECT * FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}
  `;
  return row ? mapProject(row) : null;
}

/** Project list with the counts the Projects page shows, in one query. */
export async function listProjects(tenantId: string): Promise<ProjectWithCounts[]> {
  const rows = await sql`
    SELECT p.*,
           (SELECT count(*) FROM decisions d
             WHERE d.project_id = p.id AND d.status != 'ARCHIVED') AS decision_count,
           (SELECT count(*) FROM decisions d
             WHERE d.project_id = p.id AND d.status = 'AT_RISK') AS at_risk_count,
           (SELECT count(*) FROM documents doc WHERE doc.project_id = p.id) AS document_count
    FROM projects p
    WHERE p.tenant_id = ${tenantId} AND p.archived_at IS NULL
    ORDER BY p.created_at DESC
  `;
  return rows.map((row) => ({
    ...mapProject(row),
    decisionCount: Number(row.decision_count),
    atRiskCount: Number(row.at_risk_count),
    documentCount: Number(row.document_count),
  }));
}

/**
 * Returns the tenant's default project, creating it on first use. Keeps the
 * demo and the API usable without forcing a project-selection step into
 * every flow, while still giving everything a real project_id.
 */
export async function getOrCreateDefaultProject(
  tenantId: string,
  createdBy?: string | null,
): Promise<Project> {
  const [existing] = await sql`
    SELECT * FROM projects
    WHERE tenant_id = ${tenantId} AND archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (existing) return mapProject(existing);

  return createProject({
    tenantId,
    name: "General",
    description: "Default project for decisions that haven't been filed elsewhere.",
    createdBy,
  });
}
