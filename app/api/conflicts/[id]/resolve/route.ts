import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import {
  ActionNotApplicableError,
  acceptConflictEvidence,
  dismissConflict,
} from "@/lib/engine/decisionActions";
import { IllegalStatusTransitionError } from "@/lib/domain/decisionStatus";

const ResolveSchema = z.object({
  resolution: z.enum(["dismiss", "accept"]),
  note: z.string().max(500).optional(),
});

/**
 * "Dismiss Conflict" / "Accept New Evidence" from §22.
 *
 * Neither deletes anything: dismissing marks the conflict DISMISSED and
 * restores the assumption, accepting marks it ACCEPTED and confirms the
 * assumption invalid. Both keep the conflict row and record who decided,
 * so the history stays reconstructible (§3 Principle 3).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = ResolveSchema.parse(await req.json());

    const decision =
      body.resolution === "dismiss"
        ? await dismissConflict({
            tenantId: auth.tenantId,
            conflictId: id,
            userId: auth.user.id,
            note: body.note ?? null,
          })
        : await acceptConflictEvidence({
            tenantId: auth.tenantId,
            conflictId: id,
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
