import { sql } from "@/db/client";
import type { User, UserWithPasswordHash } from "@/lib/types";

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createUser(input: {
  tenantId: string;
  email: string;
  passwordHash: string;
  name: string;
  role?: string;
}): Promise<User> {
  const [row] = await sql`
    INSERT INTO users (tenant_id, email, password_hash, name, role)
    VALUES (
      ${input.tenantId},
      ${input.email.toLowerCase().trim()},
      ${input.passwordHash},
      ${input.name},
      ${input.role ?? "owner"}
    )
    RETURNING id, tenant_id, email, name, role, created_at
  `;
  return mapUser(row);
}

export async function findUserByEmail(
  email: string,
): Promise<UserWithPasswordHash | null> {
  const [row] = await sql`
    SELECT id, tenant_id, email, name, role, password_hash, created_at
    FROM users
    WHERE email = ${email.toLowerCase().trim()}
  `;
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash as string };
}

export async function getUserById(userId: string): Promise<User | null> {
  const [row] = await sql`
    SELECT id, tenant_id, email, name, role, created_at
    FROM users
    WHERE id = ${userId}
  `;
  return row ? mapUser(row) : null;
}
