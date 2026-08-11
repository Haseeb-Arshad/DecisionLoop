/**
 * Deterministic demo seed for the scenario in decision.md §42: Northstar
 * Commerce choosing between SignalForge and MetricLake, then having that
 * decision invalidated months later by a repricing notice.
 *
 * This calls the SAME engine functions the app's API routes call
 * (extractDecisionFromNotes → createDecision → indexDecisionMemory →
 * runConflictDetectionForDocument) rather than inserting pre-baked rows —
 * so running it is itself an end-to-end exercise of the commit and
 * invalidation pipelines, not a fixture that can drift from what the app
 * actually does. §67 is explicit that the demo result must come from the
 * real pipeline.
 *
 * Requires DATABASE_URL and AWS credentials with Bedrock model access for
 * BEDROCK_REASONING_MODEL_ID and BEDROCK_EMBEDDING_MODEL_ID. S3 is bypassed
 * — there is no browser here to perform a presigned upload, so document
 * text is written directly.
 *
 * Usage: npm run db:seed
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { extractDecisionFromNotes } from "@/lib/ai/extraction";
import { embedTexts } from "@/lib/ai/embeddings";
import { authorityForSourceType } from "@/lib/domain/decisionStatus";
import { runConflictDetectionForDocument } from "@/lib/engine/conflictDetection";
import { chunkTextWithPages, hashContent } from "@/lib/engine/documentIngestion";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { startAgentRun, completeAgentRun } from "@/lib/repo/agentRuns";
import { createDecision } from "@/lib/repo/decisions";
import { createDecisionEvidence } from "@/lib/repo/evidence";
import { createDocument, updateDocumentStatus } from "@/lib/repo/documents";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { createProject } from "@/lib/repo/projects";
import { createTenant } from "@/lib/repo/tenants";
import { createUser, findUserByEmail } from "@/lib/repo/users";
import type { DocumentRecord, DocumentSourceType, User } from "@/lib/types";

const DEMO_EMAIL = "maya.chen@northstar.example";
const DEMO_PASSWORD = "decisionloop-demo";
const DEMO_DIR = path.join(process.cwd(), "demo-data");

/** Session labels are what make the cross-session claim measurable. */
const SESSION_ONE = "sess_demo_session_1";
const SESSION_TWO = "sess_demo_session_2";

function readDemoDoc(filename: string): string {
  return fs.readFileSync(path.join(DEMO_DIR, filename), "utf8");
}

/**
 * Ingests a demo document the way the real pipeline does, minus the S3
 * round-trip: hash, chunk with page attribution, embed, write memory chunks.
 */
async function ingestDemoDocument(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  filename: string;
  sourceType: DocumentSourceType;
}): Promise<DocumentRecord> {
  const text = readDemoDoc(input.filename);

  const document = await createDocument({
    tenantId: input.tenantId,
    projectId: input.projectId,
    uploadedBy: input.userId,
    filename: input.filename,
    mimeType: "text/markdown",
    s3Key: `tenants/${input.tenantId}/documents/seed-${input.filename}`,
    sizeBytes: text.length,
    sourceType: input.sourceType,
    authorityScore: authorityForSourceType(input.sourceType),
  });

  const chunks = chunkTextWithPages(text);
  const { embeddings, model } = await embedTexts(chunks.map((c) => c.content));

  await Promise.all(
    embeddings.map((embedding, i) =>
      insertMemoryChunk({
        tenantId: input.tenantId,
        projectId: input.projectId,
        sourceType: "document",
        sourceId: document.id,
        content: chunks[i]!.content,
        embedding,
        embeddingModel: model,
        pageNumber: chunks[i]!.pageNumber,
        chunkIndex: chunks[i]!.index,
        contentHash: hashContent(chunks[i]!.content),
        importance: 0.5,
        authorityScore: document.authorityScore,
        metadata: { filename: input.filename, sourceType: input.sourceType },
      }),
    ),
  );

  await updateDocumentStatus(document.id, "PROCESSED", {
    extractedText: text,
    contentHash: hashContent(text),
  });

  console.log(`  ingested ${input.filename} (${chunks.length} chunks, authority ${document.authorityScore.toFixed(2)})`);

  return { ...document, status: "PROCESSED", extractedText: text };
}

async function main() {
  console.log("Seeding DecisionLoop demo data — Northstar Commerce\n");

  const existing = await findUserByEmail(DEMO_EMAIL);
  let user: User;
  let tenantId: string;

  if (existing) {
    console.log(`Demo user ${DEMO_EMAIL} already exists — reusing tenant ${existing.tenantId}.`);
    const { passwordHash: _unused, ...rest } = existing;
    user = rest;
    tenantId = existing.tenantId;
  } else {
    const tenant = await createTenant("Northstar Commerce");
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    user = await createUser({
      tenantId: tenant.id,
      email: DEMO_EMAIL,
      passwordHash,
      name: "Maya Chen",
      role: "owner",
    });
    tenantId = tenant.id;
    console.log(`Created tenant "${tenant.name}" and user ${DEMO_EMAIL}`);
    console.log(`  Sign in with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);
  }

  const project = await createProject({
    tenantId,
    name: "Analytics Infrastructure",
    description: "Vendor selection and platform decisions for the retail analytics stack.",
    createdBy: user.id,
  });
  console.log(`Created project "${project.name}"\n`);

  // ── Session 1: evaluate vendors and commit the decision ─────────────────
  console.log("── Session 1 ──────────────────────────────────────────────");
  const runOne = await startAgentRun({
    tenantId,
    projectId: project.id,
    sessionId: SESSION_ONE,
    intent: "EXTRACT_DECISION",
    request: "Which analytics vendor should we choose?",
    createdBy: user.id,
  });
  const sessionOneStart = Date.now();

  const signalforgeProposal = await ingestDemoDocument({
    tenantId,
    projectId: project.id,
    userId: user.id,
    filename: "signalforge-proposal.md",
    sourceType: "VENDOR_OFFICIAL",
  });
  const metriclakeProposal = await ingestDemoDocument({
    tenantId,
    projectId: project.id,
    userId: user.id,
    filename: "metriclake-proposal.md",
    sourceType: "VENDOR_OFFICIAL",
  });
  const architectureReview = await ingestDemoDocument({
    tenantId,
    projectId: project.id,
    userId: user.id,
    filename: "architecture-review.md",
    sourceType: "INTERNAL_ANALYSIS",
  });

  console.log("\n  Analysing the three documents with Bedrock…");
  const material = [signalforgeProposal, metriclakeProposal, architectureReview]
    .map((d) => `Document: ${d.filename}\n${d.extractedText}`)
    .join("\n\n---\n\n");

  const extraction = await extractDecisionFromNotes(material);

  const decision = await createDecision({
    tenantId,
    projectId: project.id,
    title: extraction.title,
    problemStatement: extraction.problemStatement,
    reasoning: extraction.reasoning,
    confidence: extraction.confidence,
    importance: 0.85,
    createdBy: user.id,
    createdInSession: SESSION_ONE,
    options: extraction.options,
    assumptions: extraction.assumptions,
  });

  for (const doc of [signalforgeProposal, metriclakeProposal, architectureReview]) {
    await createDecisionEvidence({
      tenantId,
      decisionId: decision.id,
      documentId: doc.id,
      evidenceType: "SUPPORTING",
      relevance: 0.85,
      excerpt: `Analysed during vendor evaluation (${doc.filename}).`,
    });
  }

  await indexDecisionMemory(decision, { agentRunId: runOne.id, actorUserId: user.id });

  await recordAuditEvent({
    tenantId,
    actorUserId: user.id,
    action: "decision.committed",
    entityType: "decision",
    entityId: decision.id,
    metadata: { title: decision.title, seeded: true, session: SESSION_ONE },
  });

  await completeAgentRun(runOne.id, {
    status: "SUCCEEDED",
    latencyMs: Date.now() - sessionOneStart,
    memoriesWritten: decision.assumptions.length + 1,
    outputSummary: `Committed "${decision.title}".`,
  });

  console.log(`\n  Committed: "${decision.title}"`);
  console.log(`  Chosen: ${decision.options.find((o) => o.isChosen)?.name ?? "—"}`);
  for (const a of decision.assumptions) {
    console.log(`    · ${a.statement}  [${a.normalizedStatement ?? "unstructured"}]`);
  }

  console.log("\n  --- session 1 ends; agent state discarded ---\n");

  // ── Session 2: new evidence arrives, with no mention of the decision ────
  console.log("── Session 2 (weeks later, new session) ───────────────────");
  const runTwo = await startAgentRun({
    tenantId,
    projectId: project.id,
    sessionId: SESSION_TWO,
    intent: "INGEST_EVIDENCE",
    request: "Ingest document: signalforge-2027-pricing.md",
    createdBy: user.id,
  });
  const sessionTwoStart = Date.now();

  const renewalNotice = await ingestDemoDocument({
    tenantId,
    projectId: project.id,
    userId: user.id,
    filename: "signalforge-2027-pricing.md",
    sourceType: "VENDOR_OFFICIAL",
  });

  console.log("\n  Running conflict detection — nothing tells it which decision this relates to…");
  const summary = await runConflictDetectionForDocument(renewalNotice, {
    run: runTwo,
    stats: {
      memoriesRetrieved: 0,
      memoriesWritten: 0,
      conflictsDetected: 0,
      retrievalLatencyMs: 0,
    },
    recordRetrieval: () => undefined,
    recordWrites: () => undefined,
    recordConflicts: () => undefined,
  });

  await completeAgentRun(runTwo.id, {
    status: "SUCCEEDED",
    latencyMs: Date.now() - sessionTwoStart,
    conflictsDetected: summary.conflictsFound,
    outputSummary: `${summary.conflictsFound} conflict(s) across ${summary.candidatesConsidered} candidates.`,
  });

  console.log(
    `\n  Extracted ${summary.factsExtracted} fact(s); checked ${summary.candidatesConsidered} candidate assumption(s).`,
  );

  if (summary.conflictsFound > 0) {
    console.log(`  ${summary.conflictsFound} conflict(s) found.`);
    console.log(`  Assumptions invalidated: ${summary.assumptionsInvalidated}, challenged: ${summary.assumptionsChallenged}`);
    console.log(`  Decisions marked AT RISK: ${summary.decisionsMarkedAtRisk.join(", ")}`);
    console.log("\n✅ Demo scenario reproduced end-to-end through the real pipeline.");
  } else {
    console.log(
      "\n⚠️  No conflicts found. Check that AWS credentials have Bedrock model access enabled " +
        "for both BEDROCK_REASONING_MODEL_ID and BEDROCK_EMBEDDING_MODEL_ID — the local " +
        "fallback embedding has no semantic meaning, so retrieval cannot connect the pricing " +
        "notice to the stored assumption without a real embedding model.",
    );
  }

  console.log(`\nSign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}:`);
  console.log(`  Decision:        /decisions/${decision.id}`);
  console.log(`  Memory Inspector: /inspector?decisionId=${decision.id}`);
  console.log(`  Project:          /projects/${project.id}`);
}

main()
  .then(() => {
    console.log("\nSeed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nSeed failed:", err);
    process.exit(1);
  });
