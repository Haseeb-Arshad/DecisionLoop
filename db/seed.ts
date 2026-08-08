/**
 * Deterministic demo data for the defining scenario in docs/architecture.md
 * §2: SignalForge vs MetricLake, committed in "session 1," then invalidated
 * by a pricing document uploaded in "session 2" with no reference back to
 * the original decision.
 *
 * This calls the SAME engine functions the app's API routes call
 * (extractDecisionFromNotes, createDecision, indexDecisionMemory,
 * ingestDocument) rather than inserting pre-baked rows — so running this
 * script is itself a working end-to-end test of the "Commit Decision" and
 * "assumption invalidation" pipelines, not a fixture that could drift from
 * what the app actually does.
 *
 * Requires ANTHROPIC_API_KEY (extraction + conflict judgment) and
 * DATABASE_URL at minimum. AWS S3 is bypassed here — the seed script writes
 * the "uploaded" document's text directly rather than round-tripping
 * through a real S3 presigned upload, since there's no browser in this
 * script. VOYAGE_API_KEY is optional (falls back to the deterministic local
 * embedding — conflict detection still works, just with a weaker retrieval
 * signal than a real embedding model).
 *
 * Usage: npm run db:seed
 */
import "dotenv/config";
import { hashPassword } from "@/lib/auth/password";
import { extractDecisionFromNotes } from "@/lib/ai/extraction";
import { runConflictDetectionForDocument } from "@/lib/engine/conflictDetection";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { embedTexts } from "@/lib/ai/embeddings";
import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { createDecision } from "@/lib/repo/decisions";
import { createDocument, updateDocumentStatus } from "@/lib/repo/documents";
import { insertMemoryChunk } from "@/lib/repo/memoryChunks";
import { createTenant } from "@/lib/repo/tenants";
import { createUser, findUserByEmail } from "@/lib/repo/users";
import type { User } from "@/lib/types";

const DEMO_EMAIL = "demo@decisionloop.dev";
const DEMO_PASSWORD = "decisionloop-demo";

const SESSION_1_NOTES = `
We're choosing a workflow automation tool for the platform team.

We evaluated two vendors: SignalForge and MetricLake.

SignalForge has a cleaner API, faster support response times (under 2 hours
in our trial), and their pricing is currently $22,000/year for our usage
tier — comfortably under our $25,000/year budget ceiling for this category.

MetricLake has a broader integration catalog but their enterprise tier
starts at $31,000/year, which is over budget, and their support SLA is
24-48 hours.

Decision: going with SignalForge. The deciding factors were the pricing
headroom (we assumed SignalForge stays under $25,000/year) and the faster
support turnaround.
`.trim();

const SESSION_2_DOCUMENT_TEXT = `
SignalForge — Annual Contract Renewal Notice

Effective next billing cycle, SignalForge's Growth tier pricing for your
account's usage tier has been updated to $42,000/year, reflecting increased
platform usage and the new compliance-tier support add-on.

This renewal notice does not reference any internal vendor evaluation or
prior purchasing decision — it is SignalForge's standard automated pricing
update email.
`.trim();

async function main() {
  console.log("Seeding DecisionLoop demo data…\n");

  const existing = await findUserByEmail(DEMO_EMAIL);
  let user: User;
  let tenantId: string;

  if (existing) {
    console.log(`Demo user ${DEMO_EMAIL} already exists — reusing tenant ${existing.tenantId}.`);
    const { passwordHash: _unused, ...rest } = existing;
    user = rest;
    tenantId = existing.tenantId;
  } else {
    const tenant = await createTenant("DecisionLoop Demo");
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    user = await createUser({
      tenantId: tenant.id,
      email: DEMO_EMAIL,
      passwordHash,
      name: "Demo User",
      role: "owner",
    });
    tenantId = tenant.id;
    console.log(`Created tenant "${tenant.name}" (${tenant.id}) and user ${DEMO_EMAIL}.`);
    console.log(`  Sign in with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);
  }

  // ── "Session 1": commit the SignalForge decision ──────────────────────
  console.log("Session 1 — extracting and committing the SignalForge decision…");
  const extracted = await extractDecisionFromNotes(SESSION_1_NOTES);
  const decision = await createDecision({
    tenantId,
    title: extracted.title,
    problemStatement: extracted.problemStatement,
    reasoning: extracted.reasoning,
    createdBy: user.id,
    createdInSession: "session-1",
    options: extracted.options,
    assumptions: extracted.assumptions,
  });
  await indexDecisionMemory(decision);
  await recordAuditEvent({
    tenantId,
    actorUserId: user.id,
    action: "decision.committed",
    entityType: "decision",
    entityId: decision.id,
    metadata: { title: decision.title, seeded: true },
  });
  console.log(`  Committed decision "${decision.title}" (${decision.id})`);
  console.log(`  Assumptions stored: ${decision.assumptions.map((a) => a.statement).join("; ") || "(none extracted)"}\n`);

  // ── "Session 2": upload a pricing document with no reference to session 1 ──
  console.log("Session 2 — uploading SignalForge's new pricing notice (no mention of the earlier decision)…");
  const document = await createDocument({
    tenantId,
    uploadedBy: user.id,
    filename: "signalforge-renewal-notice.txt",
    mimeType: "text/plain",
    s3Key: `tenants/${tenantId}/documents/seed-demo-signalforge-renewal.txt`,
    sizeBytes: SESSION_2_DOCUMENT_TEXT.length,
  });

  // Index the document's text into memory_chunks the same way the real
  // ingestion pipeline does (lib/engine/documentIngestion.ts), skipping only
  // the S3 round-trip since this script has no browser to upload from.
  const { embeddings, model } = await embedTexts([SESSION_2_DOCUMENT_TEXT]);
  await insertMemoryChunk({
    tenantId,
    sourceType: "document",
    sourceId: document.id,
    decisionId: null,
    content: SESSION_2_DOCUMENT_TEXT,
    embedding: embeddings[0]!,
    embeddingModel: model,
  });
  await updateDocumentStatus(document.id, "PROCESSED", { extractedText: SESSION_2_DOCUMENT_TEXT });
  const processedDocument = { ...document, status: "PROCESSED" as const, extractedText: SESSION_2_DOCUMENT_TEXT };

  console.log("  Running assumption-conflict detection (independent recall, no decision hint given)…");
  const summary = await runConflictDetectionForDocument(processedDocument);

  console.log(`\nResult: extracted ${summary.factsExtracted} fact(s), checked ${summary.candidatesConsidered} candidate(s).`);
  if (summary.conflictsFound > 0) {
    console.log(`  ${summary.conflictsFound} conflict(s) found. Decisions marked AT RISK: ${summary.decisionsMarkedAtRisk.join(", ")}`);
    console.log("\n✅ Demo scenario reproduced: DecisionLoop independently flagged the SignalForge decision.");
  } else {
    console.log("  No conflicts found — check ANTHROPIC_API_KEY / VOYAGE_API_KEY are set to real credentials.");
  }

  console.log(`\nOpen the app and sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} to see it:`);
  console.log(`  Decision: /decisions/${decision.id}`);
  console.log(`  Memory Inspector: /inspector?decisionId=${decision.id}`);
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
