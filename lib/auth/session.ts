import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql } from "@/db/client";
import type { User } from "@/lib/types";

export const SESSION_COOKIE_NAME = "decisionloop_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Generate one and add it to .env.local — see .env.example.",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

/**
 * Creates a signed session JWT and a matching `auth_sessions` row.
 *
 * We use both a stateless JWT (fast to verify on every request — no DB hit
 * needed to check the signature/expiry) AND a DB-backed session row (so
 * logout / revocation actually works, and so "who was logged in when this
 * happened" is answerable from the audit trail). The JWT's `sid` claim is
 * the auth_sessions.id; verifySessionToken checks both.
 */
export async function createSession(
  user: User,
  userAgent?: string | null,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const token = await new SignJWT({ tid: user.tenantId, sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSecretKey());

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await sql`
    INSERT INTO auth_sessions (id, user_id, tenant_id, token_hash, user_agent, expires_at)
    VALUES (
      ${sessionId}, ${user.id}, ${user.tenantId}, ${tokenHash},
      ${userAgent ?? null}, ${expiresAt.toISOString()}
    )
  `;

  return token;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const userId = payload.sub;
    const tenantId = payload.tid;
    const sessionId = payload.sid;
    if (
      typeof userId !== "string" ||
      typeof tenantId !== "string" ||
      typeof sessionId !== "string"
    ) {
      return null;
    }

    const rows = await sql`
      SELECT 1 FROM auth_sessions WHERE id = ${sessionId} AND expires_at > now()
    `;
    if (rows.length === 0) return null;

    return { userId, tenantId, sessionId };
  } catch {
    return null;
  }
}

export async function destroySession(sessionId: string): Promise<void> {
  await sql`DELETE FROM auth_sessions WHERE id = ${sessionId}`;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function getSessionFromCookies(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
