import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { assertPasswordStrength, hashPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createTenant } from "@/lib/repo/tenants";
import { createUser, findUserByEmail } from "@/lib/repo/users";

const SignupSchema = z.object({
  workspaceName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const body = SignupSchema.parse(await req.json());

    const existing = await findUserByEmail(body.email);
    if (existing) {
      return jsonError("An account with that email already exists.", 409);
    }

    const strengthError = assertPasswordStrength(body.password);
    if (strengthError) return jsonError(strengthError, 400);

    const tenant = await createTenant(body.workspaceName);
    const passwordHash = await hashPassword(body.password);
    const user = await createUser({
      tenantId: tenant.id,
      email: body.email,
      passwordHash,
      name: body.name,
      role: "owner",
    });

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
