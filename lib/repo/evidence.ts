import { sql } from "@/db/client";
import type {
  DecisionEvidence,
  DecisionEvidenceWithSource,
  DecisionOutcome,
  DocumentSourceType,
  EvidenceType,
  OutcomeSentiment,
} from "@/lib/types";

function mapEvidence(row: Record<string, unknown>): DecisionEvidence {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    assumptionId: (row.assumption_id as string) ?? null,
    documentId: (row.document_id as string) ?? null,
    memoryChunkId: (row.memory_chunk_id as string) ?? null,
    evidenceType: row.evidence_type as EvidenceType,
    relevance: Number(row.relevance ?? 0.5),
    excerpt: (row.excerpt as string) ?? null,
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function mapEvidenceWithSource(
  row: Record<string, unknown>,
): DecisionEvidenceWithSource {
  return {
    ...mapEvidence(row),
    documentFilename: (row.document_filename as string) ?? null,
    documentSourceType: (row.document_source_type as DocumentSourceType) ?? null,
    documentAuthorityScore:
      row.document_authority_score === null || row.document_authority_score === undefined
        ? null
        : Number(row.document_authority_score),
  };
}

/**
 * Links a decision (and optionally a specific assumption) to the document
 * excerpt that supports or contradicts it. This is the provenance trail
 * behind §4 Principle 4 — "where did this fact come from?" — and what the
 * DECISION AT RISK card cites as its source.
 */
export async function createDecisionEvidence(input: {
  tenantId: string;
  decisionId: string;
  assumptionId?: string | null;
  documentId?: string | null;
  memoryChunkId?: string | null;
  evidenceType: EvidenceType;
  relevance?: number;
  excerpt?: string | null;
  pageNumber?: number | null;
}): Promise<DecisionEvidence> {
  const [decision] = await sql`
    SELECT project_id FROM decisions
    WHERE id = ${input.decisionId} AND tenant_id = ${input.tenantId}
  `;
  if (!decision) throw new Error("Decision not found in this workspace.");

  if (input.assumptionId) {
    const [assumption] = await sql`
      SELECT a.id
      FROM assumptions a
      JOIN decisions d ON d.id = a.decision_id
      WHERE a.id = ${input.assumptionId}
        AND a.decision_id = ${input.decisionId}
        AND d.tenant_id = ${input.tenantId}
    `;
    if (!assumption) throw new Error("Assumption not found for this decision.");
  }

  if (input.documentId) {
    const [document] = await sql`
      SELECT project_id FROM documents
      WHERE id = ${input.documentId} AND tenant_id = ${input.tenantId}
    `;
    if (!document) throw new Error("Document not found in this workspace.");
    if ((document.project_id as string | null) !== (decision.project_id as string | null)) {
      throw new Error("Evidence document does not belong to this decision project.");
    }
  }

  if (input.memoryChunkId) {
    const [chunk] = await sql`
      SELECT id, source_type, source_id, decision_id
      FROM memory_chunks
      WHERE id = ${input.memoryChunkId} AND tenant_id = ${input.tenantId}
    `;
    if (!chunk) throw new Error("Memory chunk not found in this workspace.");
    if (
      input.documentId &&
      (chunk.source_type !== "document" || chunk.source_id !== input.documentId)
    ) {
      throw new Error("Evidence memory chunk does not belong to the supplied document.");
    }
    if (chunk.decision_id && chunk.decision_id !== input.decisionId) {
      throw new Error("Evidence memory chunk does not belong to this decision.");
    }
  }

  const [row] = await sql`
    INSERT INTO decision_evidence (
      tenant_id, decision_id, assumption_id, document_id, memory_chunk_id,
      evidence_type, relevance, excerpt, page_number
    ) VALUES (
      ${input.tenantId}, ${input.decisionId}, ${input.assumptionId ?? null},
      ${input.documentId ?? null}, ${input.memoryChunkId ?? null},
      ${input.evidenceType}, ${input.relevance ?? 0.5},
      ${input.excerpt ?? null}, ${input.pageNumber ?? null}
    )
    ON CONFLICT (tenant_id, decision_id, document_id, evidence_type)
    DO UPDATE SET
      relevance = EXCLUDED.relevance,
      excerpt = EXCLUDED.excerpt,
      page_number = EXCLUDED.page_number
    RETURNING *
  `;
  return mapEvidence(row!);
}

export async function listEvidenceForDecision(
  tenantId: string,
  decisionId: string,
): Promise<DecisionEvidenceWithSource[]> {
  const rows = await sql`
    SELECT e.*,
           d.filename AS document_filename,
           d.source_type AS document_source_type,
           d.authority_score AS document_authority_score
    FROM decision_evidence e
    LEFT JOIN documents d ON d.id = e.document_id
    WHERE e.tenant_id = ${tenantId} AND e.decision_id = ${decisionId}
    ORDER BY e.created_at DESC
  `;
  return rows.map(mapEvidenceWithSource);
}

export async function listEvidenceForAssumption(
  tenantId: string,
  assumptionId: string,
): Promise<DecisionEvidenceWithSource[]> {
  const rows = await sql`
    SELECT e.*,
           d.filename AS document_filename,
           d.source_type AS document_source_type,
           d.authority_score AS document_authority_score
    FROM decision_evidence e
    LEFT JOIN documents d ON d.id = e.document_id
    WHERE e.tenant_id = ${tenantId} AND e.assumption_id = ${assumptionId}
    ORDER BY e.created_at DESC
  `;
  return rows.map(mapEvidenceWithSource);
}

// ── Outcomes (§8) ───────────────────────────────────────────────────────────

function mapOutcome(row: Record<string, unknown>): DecisionOutcome {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    summary: row.summary as string,
    sentiment: row.sentiment as OutcomeSentiment,
    recordedBy: (row.recorded_by as string) ?? null,
    observedAt: (row.observed_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function recordDecisionOutcome(input: {
  tenantId: string;
  decisionId: string;
  summary: string;
  sentiment?: OutcomeSentiment;
  recordedBy?: string | null;
}): Promise<DecisionOutcome> {
  const [row] = await sql`
    INSERT INTO decision_outcomes (tenant_id, decision_id, summary, sentiment, recorded_by)
    VALUES (
      ${input.tenantId}, ${input.decisionId}, ${input.summary},
      ${input.sentiment ?? "NEUTRAL"}, ${input.recordedBy ?? null}
    )
    RETURNING *
  `;
  return mapOutcome(row!);
}

export async function listOutcomesForDecision(
  tenantId: string,
  decisionId: string,
): Promise<DecisionOutcome[]> {
  const rows = await sql`
    SELECT * FROM decision_outcomes
    WHERE tenant_id = ${tenantId} AND decision_id = ${decisionId}
    ORDER BY observed_at DESC
  `;
  return rows.map(mapOutcome);
}
