import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/db/client";
import { setReasoningProvider } from "@/lib/ai/bedrock";
import { runConflictDetectionForDocument } from "@/lib/engine/conflictDetection";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { retrieveMemory } from "@/lib/engine/retrieval";
import { hashContent } from "@/lib/engine/documentIngestion";
import { embedTexts } from "@/lib/ai/embeddings";
import { createDecision, getDecisionById } from "@/lib/repo/decisions";
import { createDocument, updateDocumentStatus } from "@/lib/repo/documents";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { listMemoryEventsForDecision } from "@/lib/repo/memoryEvents";
import { createProject } from "@/lib/repo/projects";
import { createTenant } from "@/lib/repo/tenants";
import { listConflictEventsForDecision } from "@/lib/repo/conflictEvents";
import type { ReasoningProvider } from "@/lib/ai/reasoningProvider";
import type { DocumentRecord } from "@/lib/types";

/**
 * decision.md §25 and §45: the cross-session proof, as an automated test.
 *
 * Session A commits a decision. Everything in memory is then discarded —
 * this test holds no state between the two halves except what is in
 * CockroachDB. Session B ingests new evidence with no reference to the
 * earlier decision, and the system must find it anyway.
 *
 * Requires a real CockroachDB (DATABASE_URL). Skipped otherwise, so
 * `npm test` stays runnable without infrastructure — see
 * docs/deployment.md for how to run the full suite.
 *
 * The reasoning provider is stubbed rather than calling Bedrock: this test
 * is about persistence and retrieval, and a live model would make it
 * non-deterministic. The deterministic conflict path (§21) is exercised for
 * real — the stub's analyzeConflict is never reached for the pricing case
 * because the structured comparison resolves it first.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const stubProvider: ReasoningProvider = {
  async extractDecision() {
    throw new Error("extractDecision is not exercised by this test");
  },
  async extractFacts() {
    return [
      {
        subject: "SignalForge",
        metric: "annual_price",
        operator: "=" as const,
        value: 42000,
        unit: "USD/year",
        statement: "SignalForge annual price is now $42,000",
        sourceQuote: "**$42,000 per year**",
      },
    ];
  },
  async analyzeConflict() {
    // Reached only if the deterministic path declines. Returning UNCERTAIN
    // means a failure here shows up as "no conflict found" rather than a
    // false pass.
    return {
      relation: "UNCERTAIN" as const,
      conflictType: "EVIDENCE_CONTRADICTS" as const,
      confidence: 0,
      explanation: "stub",
      oldValue: "",
      newValue: "",
      sourceQuote: "",
      suggestedOptionName: "",
    };
  },
  async answerWithMemory() {
    return {
      answer: "stub",
      groundedInMemory: false,
      citedReferences: [],
      followUpSuggestion: "",
    };
  },
};

describeIfDb("cross-session persistent memory", () => {
  let tenantId: string;
  let projectId: string;
  let decisionId: string;

  beforeAll(async () => {
    setReasoningProvider(stubProvider);

    const tenant = await createTenant(`Test Co ${Date.now()}`);
    tenantId = tenant.id;
    const project = await createProject({ tenantId, name: "Analytics Infrastructure" });
    projectId = project.id;
  });

  afterAll(async () => {
    setReasoningProvider(null);
    if (tenantId) {
      // Cascades to every table in the schema — all of which carry
      // tenant_id or descend from something that does.
      await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
    }
    await sql.end();
  });

  it("session A: commits a decision with a structured assumption", async () => {
    const decision = await createDecision({
      tenantId,
      projectId,
      title: "Analytics vendor: SignalForge vs MetricLake",
      problemStatement: "Choose an analytics infrastructure provider.",
      reasoning: "SignalForge meets requirements at lower cost.",
      createdInSession: "session-A",
      options: [
        { name: "SignalForge", description: "$20,000/year", isChosen: true },
        {
          name: "MetricLake",
          description: "$29,000/year",
          isChosen: false,
          rejectionReason: "Higher cost for capacity we don't need yet",
        },
      ],
      assumptions: [
        {
          statement: "SignalForge annual cost remains below $25,000",
          metric: "annual_price",
          operator: "<",
          value: 25000,
          unit: "USD/year",
          importance: 0.9,
          authorityScore: 0.8,
        },
      ],
    });

    decisionId = decision.id;
    await indexDecisionMemory(decision);

    expect(decision.assumptions).toHaveLength(1);
    expect(decision.assumptions[0]!.validityStatus).toBe("VALID");
    expect(decision.assumptions[0]!.normalizedStatement).toBe("annual_price < 25000 usd/year");
  });

  it("persists the decision to CockroachDB, not to process memory", async () => {
    // Read back through a fresh query path — nothing is cached in this test.
    const reloaded = await getDecisionById(tenantId, decisionId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe("ACTIVE");
  });

  it("session B: retrieves the decision's assumption without being told it exists", async () => {
    // This is the load-bearing assertion. The query mentions only what a new
    // pricing document would say — no decision id, no title, nothing that
    // names the earlier session's work.
    const retrieval = await retrieveMemory(
      tenantId,
      "SignalForge annual price is now $42,000",
      { sourceType: "assumption", limit: 5 },
    );

    expect(retrieval.candidates.length).toBeGreaterThan(0);
    const found = retrieval.candidates.find((c) => c.decisionId === decisionId);
    expect(found, "the committed assumption should be retrievable from a new session").toBeDefined();
  });

  it("session B: new evidence moves the decision to AT_RISK", async () => {
    const text =
      "SignalForge — 2027 Contract Renewal Notice\n\n" +
      "Effective from the next billing cycle, the annual subscription for your account is " +
      "**$42,000 per year**. This reflects a repricing of the Growth tier together with the " +
      "mandatory compliance-tier support package.";

    const document = await createDocument({
      tenantId,
      projectId,
      filename: "signalforge-2027-pricing.md",
      mimeType: "text/markdown",
      s3Key: `tenants/${tenantId}/documents/test-renewal.md`,
      sourceType: "VENDOR_OFFICIAL",
      authorityScore: 0.85,
    });

    const { embeddings, model } = await embedTexts([text]);
    await insertMemoryChunk({
      tenantId,
      projectId,
      sourceType: "document",
      sourceId: document.id,
      content: text,
      embedding: embeddings[0]!,
      embeddingModel: model,
      contentHash: hashContent(text),
      authorityScore: 0.85,
    });
    await updateDocumentStatus(document.id, "PROCESSED", {
      extractedText: text,
      contentHash: hashContent(text),
    });

    const processed: DocumentRecord = {
      ...document,
      status: "PROCESSED",
      extractedText: text,
    };

    const summary = await runConflictDetectionForDocument(processed);

    expect(summary.factsExtracted).toBe(1);
    expect(summary.conflictsFound).toBe(1);
    expect(summary.assumptionsInvalidated).toBe(1);
    expect(summary.decisionsMarkedAtRisk).toContain(decisionId);

    const decision = await getDecisionById(tenantId, decisionId);
    expect(decision!.status).toBe("AT_RISK");
    expect(decision!.assumptions[0]!.validityStatus).toBe("INVALIDATED");
  });

  it("records a conflict with the old and new values and a source quote", async () => {
    const conflicts = await listConflictEventsForDecision(decisionId);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    expect(conflict.relation).toBe("CONTRADICTS");
    expect(conflict.detectionMethod).toBe("DETERMINISTIC");
    expect(conflict.oldValue).toContain("25000");
    expect(conflict.newValue).toContain("42000");
    expect(conflict.suggestedOptionId).not.toBeNull();
  });

  it("writes a memory event trail that reconstructs what happened", async () => {
    const events = await listMemoryEventsForDecision(tenantId, decisionId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("DECISION_COMMITTED");
    expect(types).toContain("ASSUMPTION_INVALIDATED");
    expect(types).toContain("DECISION_AT_RISK");
  });

  it("does not raise a duplicate conflict when the same document is re-analysed", async () => {
    const [document] = await sql`
      SELECT * FROM documents WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    const processed = {
      id: document!.id as string,
      tenantId,
      projectId,
      uploadedBy: null,
      filename: document!.filename as string,
      mimeType: "text/markdown",
      s3Key: document!.s3_key as string,
      sizeBytes: null,
      extractedText: document!.extracted_text as string,
      status: "PROCESSED" as const,
      sourceType: "VENDOR_OFFICIAL" as const,
      authorityScore: 0.85,
      contentHash: document!.content_hash as string,
      pageCount: null,
      processingError: null,
      createdAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
    };

    await runConflictDetectionForDocument(processed);

    const conflicts = await listConflictEventsForDecision(decisionId);
    expect(conflicts, "re-analysis must not duplicate the conflict").toHaveLength(1);
  });
});

describe("cross-session memory (no database configured)", () => {
  it.skipIf(Boolean(DATABASE_URL))(
    "is skipped without DATABASE_URL — see docs/deployment.md to run it",
    () => {
      expect(DATABASE_URL).toBeUndefined();
    },
  );
});
