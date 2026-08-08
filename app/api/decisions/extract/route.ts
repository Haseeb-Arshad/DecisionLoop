import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { extractDecisionFromNotes } from "@/lib/ai/extraction";

const ExtractSchema = z.object({
  notes: z.string().min(10).max(8000),
});

/**
 * Step 1 of "Commit Decision": turns freeform notes into a structured
 * preview the user reviews/edits in the UI before anything is written to
 * CockroachDB. Nothing here is persisted — see POST /api/decisions for the
 * write.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const { notes } = ExtractSchema.parse(await req.json());
    const result = await extractDecisionFromNotes(notes);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
