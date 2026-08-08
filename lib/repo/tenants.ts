import { sql } from "@/db/client";
import type { Tenant } from "@/lib/types";

function mapTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "workspace"
  );
}

export async function createTenant(name: string): Promise<Tenant> {
  const base = slugify(name);
  let slug = base;
  let attempt = 0;
  // Slugs must be unique; fall back to a short random suffix on collision
  // rather than failing signup over a cosmetic URL segment.
  for (;;) {
    const existing = await sql`SELECT 1 FROM tenants WHERE slug = ${slug}`;
    if (existing.length === 0) break;
    attempt += 1;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (attempt > 5) break;
  }

  const [row] = await sql`
    INSERT INTO tenants (name, slug)
    VALUES (${name}, ${slug})
    RETURNING id, name, slug, created_at
  `;
  return mapTenant(row!);
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const [row] = await sql`
    SELECT id, name, slug, created_at FROM tenants WHERE id = ${tenantId}
  `;
  return row ? mapTenant(row) : null;
}
