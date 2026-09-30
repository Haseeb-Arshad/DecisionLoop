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
      .object({
        resolution: z.enum(["dismiss", "accept"]),
        note: z.string().max(500).optional(),
      })
      .parse(await req.json());
    const decision = await getDecisionLoop().conflicts[body.resolution](
      actor,
      id,
      { note: body.note },
    );
    return NextResponse.json({ decision });
  } catch (error) {
    return handleApiError(error);
  }
}
