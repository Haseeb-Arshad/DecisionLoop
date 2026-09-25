import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assumptionSpecSchema } from "@decisionloop/core/assumptions/model";
import { inboundEventSchema } from "@decisionloop/core/events/event";
import { createSql, type Sql } from "@decisionloop/storage-sql/connection";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import type { NewDecisionRecord } from "@decisionloop/core/ports/store";

/**
 * Runs against the embedded PostgreSQL started by tests/setup/globalDb.ts,
 * or against CockroachDB/PostgreSQL when DATABASE_URL is set.
 */

let sql: Sql;
let store: SqlDecisionStore;
let tenantA: string;
let tenantB: string;

function decision(tenantId: string, overrides: Partial<NewDecisionRecord> = {}): NewDecisionRecord {
  return {
    tenantId,
    projectId: null,
    title: "Use Redis-backed server-side sessions",
    problemStatement: "How should we store sessions?",
    reasoning: "Immediate revocation is a customer requirement.",
    status: "ACTIVE",
    confidence: 0.8,
    importance: 0.9,
    domain: "engineering",
    scope: "auth",
    origin: "HUMAN",
    decidedByType: "USER",
    decidedByLabel: null,
    externalRef: "ADR-018",
    tags: ["auth", "sessions"],
    metadata: { team: "platform" },
    sourceRefs: [{ type: "adr", ref: "docs/adr/018.md" }],
    createdBy: null,
    createdInSession: "sess-A",
    agentSessionId: null,
    options: [
      { name: "Redis sessions", description: null, isChosen: true, rejectionReason: null },
      { name: "Stateless JWT", description: null, isChosen: false, rejectionReason: "Cannot revoke immediately" },
    ],
    assumptions: [
      assumptionSpecSchema.parse({
        statement: "Immediate session revocation is required",
        subject: "service:auth",
        predicate: "immediate revocation required",
        valueType: "BOOLEAN",
        operator: "=",
        expected: true,
        importance: 0.9,
        authority: 0.8,
      }),
      assumptionSpecSchema.parse({
        statement: "Redis p95 lookup latency stays under 15 ms",
        subject: "service:redis",
        predicate: "p95_latency_ms",
        valueType: "NUMBER",
        operator: "<",
        expected: 15,
        unit: "ms",
      }),
      assumptionSpecSchema.parse({ statement: "The platform team keeps Redis expertise" }),
    ],
    resources: [
      { type: "path", key: "src/auth/**", repository: "acme/app" },
      { type: "package", key: "npm:redis", repository: null },
    ],
    constraints: [
      { statement: "Sessions must stay revocable server-side", rule: { kind: "dependency_present", subject: "npm:redis" }, severity: "ADVISORY" },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  sql = createSql(process.env.DATABASE_URL!, { max: 1 });
  store = new SqlDecisionStore(sql);
  tenantA = (await store.createWorkspace("Store Test A")).id;
  tenantB = (await store.createWorkspace("Store Test B")).id;
});

afterAll(async () => {
  await sql`DELETE FROM jobs WHERE tenant_id IN ${sql([tenantA, tenantB])}`;
  await sql`DELETE FROM tenants WHERE id IN ${sql([tenantA, tenantB])}`;
  await sql.end();
});

describe("SqlDecisionStore — universal decision object", () => {
  it("round-trips decisions with generalized assumptions, resources and constraints", async () => {
    const d = await store.insertDecision(decision(tenantA));
    expect(d.externalRef).toBe("ADR-018");
    expect(d.tags).toEqual(["auth", "sessions"]);
    expect(d.resources?.map((r) => r.resourceKey).sort()).toEqual(["npm:redis", "src/auth/**"]);
    expect(d.constraints?.[0]?.rule).toEqual({ kind: "dependency_present", subject: "npm:redis" });

    const [bool, num, text] = d.assumptions;
    expect(bool).toMatchObject({ valueType: "BOOLEAN", predicate: "immediate_revocation_required", subject: "service:auth", expected: true });
    expect(bool!.normalizedStatement).toBe("service:auth.immediate_revocation_required = true");
    // NUMBER assumptions stay readable by the 1.x code paths.
    expect(num).toMatchObject({ metric: "p95_latency_ms", operator: "<", value: 15, valueType: "NUMBER" });
    expect(text).toMatchObject({ valueType: "TEXT", normalizedStatement: null, assumptionType: "QUALITATIVE" });

    expect((await store.getDecisionByExternalRef(tenantA, "adr-018"))?.id).toBe(d.id);
  });

  it("finds assumptions structurally by predicate, within the tenant only", async () => {
    await store.insertDecision(decision(tenantB, { externalRef: "B-1" }));
    const found = await store.findAssumptionsByPredicates(tenantA, ["Immediate Revocation Required"]);
    expect(found.length).toBe(1);
    const decisionOfFound = await store.getDecision(tenantA, found[0]!.decisionId);
    expect(decisionOfFound?.tenantId).toBe(tenantA);
  });

  it("enforces lifecycle transitions", async () => {
    const d = await store.insertDecision(decision(tenantA, { status: "DRAFT", externalRef: null }));
    await expect(store.updateDecisionStatus(tenantA, d.id, "AT_RISK")).rejects.toThrow(/Illegal/);
    const active = await store.updateDecisionStatus(tenantA, d.id, "ACTIVE");
    expect(active.validFrom).not.toBeNull();
  });

  it("another tenant cannot read or mutate a decision", async () => {
    const d = await store.insertDecision(decision(tenantA, { externalRef: null }));
    expect(await store.getDecision(tenantB, d.id)).toBeNull();
    await expect(store.updateDecisionStatus(tenantB, d.id, "ARCHIVED")).rejects.toThrow(/not found/);
    await expect(store.setAssumptionValidity(tenantB, d.assumptions[0]!.id, "INVALIDATED")).rejects.toThrow(/not found/);
  });

  it("rolls back every write in a failed transaction", async () => {
    const before = (await store.listDecisions(tenantA)).length;
    await expect(
      store.transaction(async (tx) => {
        await tx.insertDecision(decision(tenantA, { externalRef: "ROLLBACK" }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await store.listDecisions(tenantA)).length).toBe(before);
  });
});

describe("SqlDecisionStore — idempotency", () => {
  const event = () =>
    inboundEventSchema.parse({
      source: "github",
      externalId: "delivery-123",
      type: "pull_request.merged",
      occurredAt: new Date().toISOString(),
      actor: { type: "integration", label: "github" },
      provenance: { receivedVia: "webhook", signatureVerified: true },
    });

  it("a retried webhook is one event", async () => {
    const first = await store.insertEvent(tenantA, event());
    const second = await store.insertEvent(tenantA, event());
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
    // Same external id in another workspace is a different event.
    expect((await store.insertEvent(tenantB, event())).created).toBe(true);
  });

  it("identical evidence is stored once and conflicts are unique per evidence", async () => {
    const d = await store.insertDecision(decision(tenantA, { externalRef: null }));
    const item = {
      tenantId: tenantA,
      projectId: null,
      eventId: null,
      kind: "HUMAN_STATEMENT" as const,
      source: "human",
      sourceRef: null,
      subject: "service:auth",
      authority: 0.8,
      confidence: 1,
      occurredAt: new Date().toISOString(),
      content: "Immediate revocation is no longer required.",
      contentHash: "hash-1",
      facts: [],
      resources: [],
      provenance: {},
      actor: { type: "user" as const },
    };
    const e1 = await store.insertEvidence(item);
    const e2 = await store.insertEvidence(item);
    expect(e2.created).toBe(false);
    expect(e2.evidence.id).toBe(e1.evidence.id);

    const conflict = {
      tenantId: tenantA,
      decisionId: d.id,
      assumptionId: d.assumptions[0]!.id,
      evidenceItemId: e1.evidence.id,
      eventId: null,
      evaluationId: null,
      agentRunId: null,
      factStatement: "no longer required",
      explanation: "x",
      conflictType: "EVIDENCE_CONTRADICTS" as const,
      relation: "CONTRADICTS" as const,
      confidence: 1,
      oldValue: "true",
      newValue: "false",
      sourceQuote: null,
      detectionMethod: "DETERMINISTIC" as const,
    };
    expect((await store.insertConflict(conflict)).created).toBe(true);
    expect((await store.insertConflict(conflict)).created).toBe(false);
    expect((await store.listConflicts(tenantA, { decisionId: d.id })).length).toBe(1);
    // A decision in another workspace can't be the target of a conflict.
    await expect(store.insertConflict({ ...conflict, tenantId: tenantB, evidenceItemId: null })).rejects.toThrow();
  });
});

describe("SqlDecisionStore — durable jobs", () => {
  it("claims, retries with backoff, and dead-letters", async () => {
    const { job } = await store.enqueueJob({ tenantId: tenantA, kind: "test.kind", payload: { n: 1 }, dedupeKey: "t1", maxAttempts: 2 });
    expect((await store.enqueueJob({ tenantId: tenantA, kind: "test.kind", payload: { n: 1 }, dedupeKey: "t1" })).created).toBe(false);

    const [claimed] = await store.claimJobs("w1", 5, { kinds: ["test.kind"] });
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempts).toBe(1);
    // A claimed job is not handed to a second worker.
    expect(await store.claimJobs("w2", 5, { kinds: ["test.kind"] })).toEqual([]);

    const retried = await store.failJob(job.id, "transient", new Date(Date.now() - 1000));
    expect(retried.status).toBe("QUEUED");
    const [again] = await store.claimJobs("w1", 5, { kinds: ["test.kind"] });
    expect(again?.attempts).toBe(2);
    const dead = await store.failJob(job.id, "still failing", new Date());
    expect(dead.status).toBe("DEAD");
    expect(dead.lastError).toBe("still failing");
  });

  it("reclaims a job whose worker died", async () => {
    const { job } = await store.enqueueJob({ tenantId: tenantA, kind: "test.stale", payload: {} });
    await store.claimJobs("dead-worker", 1, { kinds: ["test.stale"] });
    const [reclaimed] = await store.claimJobs("w2", 1, { kinds: ["test.stale"], lockTimeoutMs: -1 });
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.lockedBy).toBe("w2");
  });
});

describe("SqlDecisionStore — machine credentials", () => {
  it("stores only a hash and honours revocation", async () => {
    const key = await store.createApiKey({ tenantId: tenantA, name: "ci", keyPrefix: "dl_abc", keyHash: "h-123", scopes: ["read", "propose"], actorType: "agent" });
    expect((await store.findApiKeyByHash("h-123"))?.scopes).toEqual(["read", "propose"]);
    await store.revokeApiKey(tenantB, key.id); // wrong tenant: no effect
    expect(await store.findApiKeyByHash("h-123")).not.toBeNull();
    await store.revokeApiKey(tenantA, key.id);
    expect(await store.findApiKeyByHash("h-123")).toBeNull();
  });
});
