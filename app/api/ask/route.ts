import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { sessionIdFor } from "@/lib/engine/agentRun";
import { askDecisionLoop } from "@/lib/engine/askDecisionLoop";

const AskSchema = z.object({
  question: z.string().min(3).max(1000),
  projectId: z.string().uuid().optional(),
  decisionId: z.string().uuid().optional(),
});

/**
 * "Ask DecisionLoop" (§40). Answers strictly from retrieved organizational
 * memory and returns `groundedInMemory: false` when the memory isn't there
 * rather than inventing history (§41). The response carries the agent run
 * and memory trace ids so the UI can deep-link into the Memory Inspector
 * and show exactly which rows produced the answer.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = AskSchema.parse(await req.json());

    const result = await askDecisionLoop({
      tenantId: auth.tenantId,
      sessionId: sessionIdFor(auth.sessionId),
      question: body.question,
      projectId: body.projectId ?? null,
      focusDecisionId: body.decisionId ?? null,
      userId: auth.user.id,
    });

    return NextResponse.json({
      answer: result.answer,
      agentRunId: result.agentRunId,
      memoryTraceId: result.memoryTraceId,
      retrievalLatencyMs: result.retrievalLatencyMs,
      retrievedCount: result.candidates.length,
      usedCount: result.usedChunkIds.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
