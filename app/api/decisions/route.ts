import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { sessionIdFor } from "@/lib/engine/agentRun";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createDecision, listDecisions } from "@/lib/repo/decisions";
import { createDecisionEvidence } from "@/lib/repo/evidence";
import { getOrCreateDefaultProject } from "@/lib/repo/projects";
import type { DecisionStatus } from "@/lib/types";

const DECISION_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "AT_RISK",
  "REOPENED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;

const OptionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  isChosen: z.boolean(),
  rejectionReason: z.string().optional().default(""),
});

const AssumptionSchema = z.object({
  statement: z.string().min(1),
  assumptionType: z
    .enum(["QUANTITATIVE", "QUALITATIVE", "REGULATORY", "CAPACITY", "TEMPORAL"])
    .default("QUANTITATIVE"),
  metric: z.string().optional().default(""),
  operator: z.enum(["<", "<=", ">", ">=", "="]).optional(),
  value: z.number().optional(),
  unit: z.string().optional().default(""),
  importance: z.number().min(0).max(1).default(0.6),
  confidence: z.number().min(0).max(1).default(0.7),
});

const CreateDecisionSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  problemStatement: z.string().max(2000).optional(),
  reasoning: z.string().max(4000).optional(),
  confidence: z.number().min(0).max(1).default(0.7),
  importance: z.number().min(0).max(1).default(0.6),
  options: z.array(OptionSchema).min(1),
  assumptions: z.array(AssumptionSchema).default([]),
  /** Documents that informed this decision, linked as supporting evidence. */
  evidenceDocumentIds: z.array(z.string().uuid()).default([]),
  evidenceReferences: z
    .array(z.object({ quote: z.string(), supports: z.string().default("") }))
    .default([]),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const statusParam = req.nextUrl.searchParams.get("status");
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;

    const status =
      statusParam && (DECISION_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as DecisionStatus)
        : undefined;

    const decisions = await listDecisions(auth.tenantId, { status, projectId });
    return NextResponse.json({ decisions });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * "Commit Decision" write path (§18): persists the structured decision
 * (options + assumptions), links the documents that informed it as
 * supporting evidence, and immediately indexes it into memory_chunks so it
 * becomes retrievable — including from a document uploaded in a completely
 * different, later session.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = CreateDecisionSchema.parse(await req.json());

    const chosenCount = body.options.filter((o) => o.isChosen).length;
    if (chosenCount !== 1) {
      return NextResponse.json(
        { error: "Exactly one option must be marked as chosen." },
        { status: 400 },
      );
    }

    const projectId =
      body.projectId ?? (await getOrCreateDefaultProject(auth.tenantId, auth.user.id)).id;

    const decision = await createDecision({
      tenantId: auth.tenantId,
      projectId,
      title: body.title,
      problemStatement: body.problemStatement,
      reasoning: body.reasoning,
      confidence: body.confidence,
      importance: body.importance,
      createdBy: auth.user.id,
      createdInSession: sessionIdFor(auth.sessionId),
      options: body.options,
      assumptions: body.assumptions
        .filter((a) => a.operator && a.value !== undefined)
        .map((a) => ({
          statement: a.statement,
          assumptionType: a.assumptionType,
          metric: a.metric || null,
          operator: a.operator ?? null,
          value: a.value ?? null,
          unit: a.unit || null,
          importance: a.importance,
          confidence: a.confidence,
        })),
    });

    // Provenance: which documents this decision was made from (§11).
    for (const documentId of body.evidenceDocumentIds) {
      await createDecisionEvidence({
        tenantId: auth.tenantId,
        decisionId: decision.id,
        documentId,
        evidenceType: "SUPPORTING",
        relevance: 0.8,
        excerpt:
          body.evidenceReferences[0]?.quote ??
          "Attached during the decision workflow.",
      });
    }

    const { chunksWritten } = await indexDecisionMemory(decision, {
      actorUserId: auth.user.id,
    });

    await recordAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.user.id,
      action: "decision.committed",
      entityType: "decision",
      entityId: decision.id,
      metadata: {
        title: decision.title,
        chunksWritten,
        assumptionCount: decision.assumptions.length,
        evidenceDocumentIds: body.evidenceDocumentIds,
      },
    });

    return NextResponse.json({ decision });
  } catch (err) {
    return handleApiError(err);
  }
}
