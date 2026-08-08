import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { clearSessionCookie, destroySession, getSessionFromCookies } from "@/lib/auth/session";

export async function POST() {
  try {
    const claims = await getSessionFromCookies();
    if (claims) await destroySession(claims.sessionId);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
