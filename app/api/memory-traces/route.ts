import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { listMemoryTraces } from "@/lib/repo/memoryTraces";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const decisionId = req.nextUrl.searchParams.get("decisionId") ?? undefined;
    const traces = await listMemoryTraces(auth.tenantId, { decisionId, limit: 100 });
    return NextResponse.json({ traces });
  } catch (err) {
    return handleApiError(err);
  }
}
