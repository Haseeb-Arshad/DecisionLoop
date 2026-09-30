import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { assertPasswordStrength, hashPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createTenant } from "@/lib/repo/tenants";
import { createUser, findUserByEmail, getUserById } from "@/lib/repo/users";
import { ForbiddenError } from "@decisionloop/core/errors";
import { sql } from "@/db/client";
import { getTenantById } from "@/lib/repo/tenants";
import { limitAuthentication } from "@/lib/api/limits";

const SignupSchema = z.object({
  workspaceName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function GET() {
  try {
    const localWorkspace = globalThis.__decisionloop_local_workspace__;
    if (localWorkspace) {
      const tenant = await getTenantById(localWorkspace);
      const [user] =
        await sql`SELECT id FROM users WHERE tenant_id = ${localWorkspace} LIMIT 1`;
      return NextResponse.json({
        available: Boolean(tenant) && !user,
        local: true,
        workspaceName: tenant?.name ?? null,
      });
    }
    return NextResponse.json({
      available:
        process.env.NODE_ENV !== "production" ||
        process.env.DECISIONLOOP_ALLOW_SIGNUP === "true",
      local: false,
      workspaceName: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await limitAuthentication(req, "signup");
    const localWorkspace = globalThis.__decisionloop_local_workspace__;
    if (
      !localWorkspace &&
      process.env.NODE_ENV === "production" &&
      process.env.DECISIONLOOP_ALLOW_SIGNUP !== "true"
    ) {
      return jsonError(
        "Workspace registration is closed. Ask your administrator for access.",
        403,
      );
    }
    if (localWorkspace) {
      const [existingUser] =
        await sql`SELECT id FROM users WHERE tenant_id = ${localWorkspace} LIMIT 1`;
      if (existingUser)
        return jsonError(
          "This local workspace already has an account. Sign in to continue.",
          403,
        );
    }
    const body = SignupSchema.parse(await req.json());

    const existing = await findUserByEmail(body.email);
    if (existing) {
      return jsonError("An account with that email already exists.", 409);
    }

    const strengthError = assertPasswordStrength(body.password);
    if (strengthError) return jsonError(strengthError, 400);

    const tenant = localWorkspace
      ? await getTenantById(localWorkspace)
      : await createTenant(body.workspaceName);
    if (!tenant) return jsonError("Workspace not found.", 404);
    const passwordHash = await hashPassword(body.password);
    const input = {
      tenantId: tenant.id,
      email: body.email,
      passwordHash,
      name: body.name,
      role: "owner",
    };
    // Lock the workspace during bootstrap so simultaneous requests cannot
    // both create an owner in a local installation.
    const user = localWorkspace
      ? await (async () => {
          const id = await sql.begin(async (tx) => {
            await tx`SELECT id FROM tenants WHERE id = ${localWorkspace} FOR UPDATE`;
            const [existingOwner] =
              await tx`SELECT id FROM users WHERE tenant_id = ${localWorkspace} LIMIT 1`;
            if (existingOwner)
              throw new ForbiddenError(
                "This local workspace already has an account. Sign in to continue.",
              );
            const [row] =
              await tx`INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES (${input.tenantId}, ${input.email.toLowerCase().trim()}, ${input.passwordHash}, ${input.name}, 'owner') RETURNING id`;
            return row!.id as string;
          });
          return (await getUserById(id))!;
        })()
      : await createUser(input);

    const token = await createSession(user, req.headers.get("user-agent"));
    await setSessionCookie(token);

    await recordAuditEvent({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "auth.signup",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email },
    });

    return NextResponse.json({ user, tenant });
  } catch (err) {
    return handleApiError(err);
  }
}
