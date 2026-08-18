import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { sessionIdFor } from "@/lib/engine/agentRun";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import {
  createDecision,
  findDecisionByCommitKey,
  listDecisions,
  setDecisionMemoryIndexStatus,
} from "@/lib/repo/decisions";
import { createDecisionEvidence } from "@/lib/repo/evidence";
import { getOrCreateDefaultProject, getProjectById } from "@/lib/repo/projects";
import { getDocumentById } from "@/lib/repo/documents";
import type { DecisionStatus, DecisionWithDetails } from "@/lib/types";

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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

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

    const commitKey = req.headers.get("Idempotency-Key")?.trim() || null;
    if (commitKey && (commitKey.length < 8 || commitKey.length > 200)) {
      return NextResponse.json(
        { error: "Idempotency-Key must be between 8 and 200 characters." },
        { status: 400 },
      );
    }
    const commitFingerprint = commitKey
      ? crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex")
      : null;

    const chosenCount = body.options.filter((o) => o.isChosen).length;
    if (chosenCount !== 1) {
      return NextResponse.json(
        { error: "Exactly one option must be marked as chosen." },
        { status: 400 },
      );
    }

    let decision: DecisionWithDetails | undefined;
    let replayed = false;
    if (commitKey) {
      const existing = await findDecisionByCommitKey(auth.tenantId, commitKey);
      if (existing) {
        if (existing.fingerprint !== commitFingerprint) {
          return NextResponse.json(
            { error: "This Idempotency-Key was already used for a different decision." },
            { status: 409 },
          );
        }
        if (existing.decision.memoryIndexStatus === "INDEXED") {
          return NextResponse.json({ decision: existing.decision, replayed: true });
        }
        decision = existing.decision;
        replayed = true;
      }
    }

    const requestedProjectId = decision?.projectId ?? body.projectId;
    const project = requestedProjectId
      ? await getProjectById(auth.tenantId, requestedProjectId)
      : await getOrCreateDefaultProject(auth.tenantId, auth.user.id);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const projectId = project.id;

    const evidenceDocuments = await Promise.all(
      body.evidenceDocumentIds.map((documentId) => getDocumentById(auth.tenantId, documentId)),
    );
    if (evidenceDocuments.some((document) => !document)) {
      return NextResponse.json(
        { error: "One or more supporting documents were not found in this workspace." },
        { status: 404 },
      );
    }
    if (evidenceDocuments.some((document) => document!.projectId !== projectId)) {
      return NextResponse.json(
        { error: "Supporting documents must belong to the decision project." },
        { status: 400 },
      );
    }

    if (!decision) {
      try {
        decision = await createDecision({
          tenantId: auth.tenantId,
          projectId,
          title: body.title,
          problemStatement: body.problemStatement,
          reasoning: body.reasoning,
          confidence: body.confidence,
          importance: body.importance,
          createdBy: auth.user.id,
          createdInSession: sessionIdFor(auth.sessionId),
          commitKey,
          commitFingerprint,
          options: body.options,
          // Preserve qualitative/regulatory/temporal assumptions even when they
          // do not have a numeric operator/value pair. Deterministic conflict
          // detection simply ignores the non-quantitative subset.
          assumptions: body.assumptions.map((a) => ({
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
      } catch (err) {
        // Two identical requests can pass the preflight lookup concurrently.
        // The unique index is authoritative; recover its winner and continue
        // the same retryable pipeline instead of returning a spurious 500.
        if (!commitKey || !isUniqueViolation(err)) throw err;
        const existing = await findDecisionByCommitKey(auth.tenantId, commitKey);
        if (!existing) throw err;
        if (existing.fingerprint !== commitFingerprint) {
          return NextResponse.json(
            { error: "This Idempotency-Key was already used for a different decision." },
            { status: 409 },
          );
        }
        decision = existing.decision;
        replayed = true;
      }
    }

    if (!decision) throw new Error("Decision commit did not produce a decision row.");

    await setDecisionMemoryIndexStatus(auth.tenantId, decision.id, "PENDING", null);

    try {
      // Provenance: which documents informed this decision (§11). The
      // repository upsert makes a retry safe after a timeout.
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
        dedupeKey: commitKey ? `decision:${commitKey}` : null,
      });
      const indexedDecision = await setDecisionMemoryIndexStatus(
        auth.tenantId,
        decision.id,
        "INDEXED",
        null,
      );

      await recordAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.user.id,
        action: "decision.committed",
        entityType: "decision",
        entityId: decision.id,
        dedupeKey: commitKey ? `decision:${commitKey}:audit` : null,
        metadata: {
          title: decision.title,
          chunksWritten,
          assumptionCount: decision.assumptions.length,
          evidenceDocumentIds: body.evidenceDocumentIds,
          replayed,
        },
      });

      return NextResponse.json({
        decision: indexedDecision ?? { ...decision, memoryIndexStatus: "INDEXED", memoryIndexError: null },
        replayed,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message.slice(0, 1000) : "Commit failed.";
      const failedDecision = await setDecisionMemoryIndexStatus(
        auth.tenantId,
        decision.id,
        "FAILED",
        errorMessage,
      );
      await recordAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.user.id,
        action: "decision.commit_failed",
        entityType: "decision",
        entityId: decision.id,
        dedupeKey: commitKey ? `decision:${commitKey}:failed` : null,
        metadata: { error: errorMessage },
      }).catch(() => undefined);
      return NextResponse.json(
        {
          decision: failedDecision ?? { ...decision, memoryIndexStatus: "FAILED", memoryIndexError: errorMessage },
          error: "Decision saved, but memory indexing needs to be retried.",
          retryable: true,
        },
        { status: 202 },
      );
    }
  } catch (err) {
    return handleApiError(err);
  }
}
