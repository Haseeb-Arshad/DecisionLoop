import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { sessionIdFor } from "@/lib/engine/agentRun";
import { askDecisionLoop } from "@/lib/engine/askDecisionLoop";
import { getDecisionById } from "@/lib/repo/decisions";
import { getProjectById } from "@/lib/repo/projects";

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

    if (body.projectId) {
      const project = await getProjectById(auth.tenantId, body.projectId);
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (body.decisionId) {
      const decision = await getDecisionById(auth.tenantId, body.decisionId);
      if (!decision) return NextResponse.json({ error: "Decision not found." }, { status: 404 });
      if (body.projectId && decision.projectId !== body.projectId) {
        return NextResponse.json(
          { error: "Decision does not belong to the requested project." },
          { status: 400 },
        );
      }
    }

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
