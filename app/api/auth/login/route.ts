import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { findUserByEmail } from "@/lib/repo/users";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = LoginSchema.parse(await req.json());

    const userWithHash = await findUserByEmail(body.email);
    if (!userWithHash) return jsonError("Invalid email or password.", 401);

    const valid = await verifyPassword(body.password, userWithHash.passwordHash);
    if (!valid) return jsonError("Invalid email or password.", 401);

    const { passwordHash: _unused, ...user } = userWithHash;
    const token = await createSession(user, req.headers.get("user-agent"));
    await setSessionCookie(token);

    await recordAuditEvent({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    });

    return NextResponse.json({ user });
  } catch (err) {
    return handleApiError(err);
  }
}
