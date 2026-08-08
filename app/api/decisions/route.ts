import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createDecision, listDecisions } from "@/lib/repo/decisions";

const OptionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  isChosen: z.boolean(),
  rejectionReason: z.string().optional().default(""),
});

const AssumptionSchema = z.object({
  statement: z.string().min(1),
  metric: z.string().optional().default(""),
  operator: z.enum(["<", "<=", ">", ">=", "="]).optional(),
  value: z.number().optional(),
  unit: z.string().optional().default(""),
});

const CreateDecisionSchema = z.object({
  title: z.string().min(1).max(200),
  problemStatement: z.string().max(2000).optional(),
  reasoning: z.string().max(4000).optional(),
  createdInSession: z.string().max(60).optional(),
  options: z.array(OptionSchema).min(1),
  assumptions: z.array(AssumptionSchema).default([]),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const status = req.nextUrl.searchParams.get("status");
    const decisions = await listDecisions(auth.tenantId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: (status as any) || undefined,
    });
    return NextResponse.json({ decisions });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * "Commit Decision" write path: persists the structured decision (options +
 * assumptions) and immediately indexes it into memory_chunks so it becomes
 * retrievable — including from a document uploaded in a completely
 * different, later session (see lib/engine/conflictDetection.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = CreateDecisionSchema.parse(await req.json());

    if (!body.options.some((o) => o.isChosen)) {
      return NextResponse.json(
        { error: "Exactly one option must be marked as chosen." },
        { status: 400 },
      );
    }

    const decision = await createDecision({
      tenantId: auth.tenantId,
      title: body.title,
      problemStatement: body.problemStatement,
      reasoning: body.reasoning,
      createdBy: auth.user.id,
      createdInSession: body.createdInSession,
      options: body.options,
      assumptions: body.assumptions
        .filter((a) => a.operator && a.value !== undefined)
        .map((a) => ({
          statement: a.statement,
          metric: a.metric || null,
          operator: a.operator ?? null,
          value: a.value ?? null,
          unit: a.unit || null,
        })),
    });

    const { chunksWritten } = await indexDecisionMemory(decision);

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "decision.committed",
      entityType: "decision",
      entityId: decision.id,
      metadata: { title: decision.title, chunksWritten },
    });

    return NextResponse.json({ decision });
  } catch (err) {
    return handleApiError(err);
  }
}
