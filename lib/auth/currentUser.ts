import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/repo/users";
import type { User } from "@/lib/types";

export interface AuthContext {
  user: User;
  tenantId: string;
  sessionId: string;
}

/** Server-side helper for pages/route handlers. Returns null when signed out. */
export async function getCurrentAuth(): Promise<AuthContext | null> {
  const claims = await getSessionFromCookies();
  if (!claims) return null;

  const user = await getUserById(claims.userId);
  if (!user || user.tenantId !== claims.tenantId) return null;

  return { user, tenantId: claims.tenantId, sessionId: claims.sessionId };
}

/** Throws a typed error a route handler can catch and turn into a 401. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getCurrentAuth();
  if (!auth) throw new UnauthenticatedError();
  return auth;
}
