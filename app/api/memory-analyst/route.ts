import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { ANALYST_QUESTIONS, runMemoryAnalystQuery } from "@/lib/mcp/cockroachClient";

const AnalystSchema = z.object({
  questionId: z.string().min(1),
});

/** The catalogue of questions the Decision Memory Analyst can answer. */
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({
      questions: ANALYST_QUESTIONS.map((q) => ({
        id: q.id,
        label: q.label,
        description: q.description,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Decision Memory Analyst (§27): answers a catalogued question about
 * structured organizational memory through a real CockroachDB Managed MCP
 * `select_query` tool call. The tool call and its raw result are returned
 * alongside the answer so the integration is visible rather than asserted.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = AnalystSchema.parse(await req.json());

    const result = await runMemoryAnalystQuery(auth.tenantId, body.questionId);

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "memory_analyst.query",
      entityType: "mcp",
      metadata: {
        questionId: result.questionId,
        verified: result.verification.verified,
      },
    });

    return NextResponse.json({ result });
  } catch (err) {
    return handleApiError(err);
  }
}
