import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/db/client";
import { createDecisionLoop } from "@decisionloop/core/services/index";
import { factSchema } from "@decisionloop/core/assumptions/facts";
import type { ReasoningProvider } from "@decisionloop/core/ports/providers";
import { LexicalEmbeddingProvider } from "@decisionloop/providers";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { setDecisionLoop } from "@/lib/decisionloopInstance";
import { evaluateDocumentAsEvidence, hashContent } from "@/lib/engine/documentIngestion";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { createDecision, getDecisionById } from "@/lib/repo/decisions";
import { createDocument } from "@/lib/repo/documents";
import { listEvidenceForDecision } from "@/lib/repo/evidence";
import { listConflictEventsForDecision } from "@/lib/repo/conflictEvents";
import { createProject } from "@/lib/repo/projects";
import { createTenant } from "@/lib/repo/tenants";

/**
 * 2.0 routes uploaded documents through the trigger engine. A decision
 * committed through the 1.x path must still be found and flagged, and the
 * 1.x UI's links (conflict → document, evidence → document) must still work.
 */

const extractingModel: ReasoningProvider = {
  name: "scripted-extractor",
  async extractFacts(text) {
    return text.includes("$42,000")
      ? [factSchema.parse({ subject: "SignalForge", predicate: "annual_price", valueType: "NUMBER", value: 42000, unit: "USD/year", statement: "SignalForge now costs $42,000/year", quote: "$42,000 per year", extractor: "scripted" })]
      : [];
  },
  async judge() {
    return { relation: "IRRELEVANT", confidence: 0.9, explanation: "n/a", quote: "" };
  },
};

let tenantId: string;
let projectId: string;

beforeAll(async () => {
  setDecisionLoop(
    createDecisionLoop({ store: new SqlDecisionStore(sql), embeddings: new LexicalEmbeddingProvider(), reasoning: extractingModel }),
  );
  tenantId = (await createTenant(`Doc Evidence ${Date.now()}`)).id;
  projectId = (await createProject({ tenantId, name: "Analytics" })).id;
});

afterAll(async () => {
  setDecisionLoop(null);
  await sql`DELETE FROM jobs WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  await sql.end();
});

describe("uploaded documents are evidence events", () => {
  it("flags a 1.x decision AT RISK and keeps the document links the UI renders", async () => {
    const decision = await createDecision({
      tenantId,
      projectId,
      title: "Analytics vendor: SignalForge",
      createdInSession: "session-1",
      options: [
        { name: "SignalForge", isChosen: true },
        { name: "MetricLake", isChosen: false, rejectionReason: "More expensive" },
      ],
      assumptions: [{ statement: "SignalForge costs under $25,000/year", metric: "annual_price", operator: "<", value: 25000, unit: "USD/year", authorityScore: 0.8 }],
    });
    await indexDecisionMemory(decision);

    const text = "SignalForge renewal notice. Effective next cycle the subscription is $42,000 per year.";
    const document = await createDocument({
      tenantId,
      projectId,
      filename: "signalforge-renewal.md",
      mimeType: "text/markdown",
      s3Key: "test/renewal.md",
      sourceType: "VENDOR_OFFICIAL",
      authorityScore: 0.85,
    });

    const summary = await evaluateDocumentAsEvidence({ ...document, contentHash: hashContent(text) }, text, { userId: null });
    expect(summary.factsExtracted).toBe(1);
    expect(summary.conflictsFound).toBe(1);
    expect(summary.assumptionsInvalidated).toBe(1);
    expect(summary.decisionsMarkedAtRisk).toEqual([decision.id]);

    expect((await getDecisionById(tenantId, decision.id))?.status).toBe("AT_RISK");
    const [conflict] = await listConflictEventsForDecision(tenantId, decision.id);
    expect(conflict?.documentId).toBe(document.id);
    expect(conflict?.detectionMethod).toBe("DETERMINISTIC");
    const evidence = await listEvidenceForDecision(tenantId, decision.id);
    expect(evidence.find((e) => e.evidenceType === "CONTRADICTING")?.documentFilename).toBe("signalforge-renewal.md");

    // Re-uploading the same content is the same event: no second conflict.
    const again = await evaluateDocumentAsEvidence({ ...document, contentHash: hashContent(text) }, text, { userId: null });
    expect(again.conflictsFound).toBe(1);
    expect(await listConflictEventsForDecision(tenantId, decision.id)).toHaveLength(1);
  });
});
