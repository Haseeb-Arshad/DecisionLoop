import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { userActor } from "@/lib/auth/actor";
import { getDecisionLoop } from "@/lib/decisionloopInstance";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = userActor(await requireAuth());
    const { id } = await params;
    const body = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("reopen"),
          note: z.string().max(500).optional(),
        }),
        z.object({
          action: z.literal("supersede"),
          supersededByDecisionId: z.string().uuid(),
          note: z.string().max(500).optional(),
        }),
      ])
      .parse(await req.json());
    const loop = getDecisionLoop();
    const decision =
      body.action === "reopen"
        ? await loop.conflicts.reopen(actor, id, body.note)
        : await loop.decisions.supersede(
            actor,
            id,
            body.supersededByDecisionId,
            body.note,
          );
    return NextResponse.json({ decision });
  } catch (error) {
    return handleApiError(error);
  }
}
