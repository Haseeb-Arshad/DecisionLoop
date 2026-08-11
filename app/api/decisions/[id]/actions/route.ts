import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import {
  ActionNotApplicableError,
  reopenDecision,
  supersedeDecision,
} from "@/lib/engine/decisionActions";
import { IllegalStatusTransitionError } from "@/lib/domain/decisionStatus";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reopen"),
    conflictId: z.string().uuid().optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("supersede"),
    supersededByDecisionId: z.string().uuid(),
    note: z.string().max(500).optional(),
  }),
]);

/**
 * The explicit human decisions from §22's action bar. The AI recommends;
 * a person acts. Every branch here requires an authenticated user and
 * leaves both a memory_event and an audit_event behind.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = ActionSchema.parse(await req.json());

    if (body.action === "reopen") {
      const decision = await reopenDecision({
        tenantId: auth.tenantId,
        decisionId: id,
        userId: auth.user.id,
        conflictId: body.conflictId ?? null,
        note: body.note ?? null,
      });
      return NextResponse.json({ decision });
    }

    const decision = await supersedeDecision({
      tenantId: auth.tenantId,
      decisionId: id,
      supersededByDecisionId: body.supersededByDecisionId,
      userId: auth.user.id,
      note: body.note ?? null,
    });
    return NextResponse.json({ decision });
  } catch (err) {
    if (err instanceof ActionNotApplicableError) return jsonError(err.message, 404);
    if (err instanceof IllegalStatusTransitionError) return jsonError(err.message, 409);
    return handleApiError(err);
  }
}
