import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { listRecentAuditEvents } from "@/lib/repo/auditEvents";

export async function GET() {
  try {
    const auth = await requireAuth();
    const events = await listRecentAuditEvents(auth.tenantId, 100);
    return NextResponse.json({ events });
  } catch (err) {
    return handleApiError(err);
  }
}
