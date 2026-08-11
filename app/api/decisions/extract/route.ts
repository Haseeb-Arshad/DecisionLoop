import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/handler";
import { requireAuth } from "@/lib/auth/currentUser";
import { extractDecisionFromNotes } from "@/lib/ai/extraction";
import { withAgentRun, sessionIdFor } from "@/lib/engine/agentRun";
import { getDocumentById } from "@/lib/repo/documents";
import type { DecisionExtractionResult } from "@/lib/ai/reasoningProvider";

const ExtractSchema = z.object({
  notes: z.string().max(8000).optional().default(""),
  /** Attached evidence — the §18 workflow analyses documents, not just prose. */
  documentIds: z.array(z.string().uuid()).max(10).default([]),
});

/**
 * Step 3 of "New Decision" (§18): analyses the description plus any
 * attached documents and returns a structured recommendation — options,
 * reasoning, assumptions, risks, evidence references — for the human to
 * review. Nothing is persisted here; POST /api/decisions is the commit.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = ExtractSchema.parse(await req.json());

    const documents = await Promise.all(
      body.documentIds.map((id) => getDocumentById(auth.tenantId, id)),
    );
    const usableDocs = documents.filter(
      (d): d is NonNullable<typeof d> => Boolean(d?.extractedText),
    );

    if (!body.notes.trim() && usableDocs.length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide a description of the decision, or attach at least one processed document.",
        },
        { status: 400 },
      );
    }

    const material = [
      body.notes.trim() ? `Team notes:\n${body.notes.trim()}` : "",
      ...usableDocs.map(
        (doc) =>
          `Document: ${doc.filename} (source type: ${doc.sourceType}, authority ${doc.authorityScore.toFixed(2)})\n${doc.extractedText}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const { result } = await withAgentRun<DecisionExtractionResult>(
      {
        tenantId: auth.tenantId,
        sessionId: sessionIdFor(auth.sessionId),
        intent: "EXTRACT_DECISION",
        request: body.notes.slice(0, 500) || `Analyse ${usableDocs.length} document(s)`,
        createdBy: auth.user.id,
      },
      async () => {
        const extraction = await extractDecisionFromNotes(material);
        return {
          result: extraction,
          outputSummary: `Recommended "${
            extraction.options.find((o) => o.isChosen)?.name ?? "—"
          }" with ${extraction.assumptions.length} assumption(s).`,
        };
      },
    );

    return NextResponse.json({
      ...result,
      analysedDocuments: usableDocs.map((d) => ({ id: d.id, filename: d.filename })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
