import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/db/client";
import { embedText } from "@/lib/ai/embeddings";
import { indexDecisionMemory } from "@/lib/engine/decisionMemory";
import { retrieveMemory } from "@/lib/engine/retrieval";
import { createDecision, getDecisionById, listDecisions } from "@/lib/repo/decisions";
import { createProject } from "@/lib/repo/projects";
import { createTenant } from "@/lib/repo/tenants";
import { searchMemoryChunks } from "@/lib/repo/memoryChunks";

/**
 * §26 and §34: semantic search must never reach across tenants, and §72's
 * red-team question "can another tenant's memory leak?" needs an answer
 * that is tested rather than asserted.
 *
 * Two tenants store deliberately near-identical decisions, so vector
 * similarity alone would happily surface the wrong one if tenant scoping
 * were missing or applied after ranking.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("tenant isolation", () => {
  let tenantA: string;
  let tenantB: string;
  let decisionA: string;
  let decisionB: string;

  beforeAll(async () => {
    const a = await createTenant(`Tenant A ${Date.now()}`);
    const b = await createTenant(`Tenant B ${Date.now()}`);
    tenantA = a.id;
    tenantB = b.id;

    const projectA = await createProject({ tenantId: tenantA, name: "Analytics" });
    const projectB = await createProject({ tenantId: tenantB, name: "Analytics" });

    const decA = await createDecision({
      tenantId: tenantA,
      projectId: projectA.id,
      title: "Analytics vendor: SignalForge vs MetricLake",
      reasoning: "SignalForge is cheaper and meets EU residency.",
      options: [{ name: "SignalForge", isChosen: true }],
      assumptions: [
        {
          statement: "SignalForge annual cost remains below $25,000",
          metric: "annual_price",
          operator: "<",
          value: 25000,
          unit: "USD/year",
        },
      ],
    });
    decisionA = decA.id;
    await indexDecisionMemory(decA);

    // Near-identical content in the other tenant — the hard case.
    const decB = await createDecision({
      tenantId: tenantB,
      projectId: projectB.id,
      title: "Analytics vendor: SignalForge vs MetricLake",
      reasoning: "SignalForge is cheaper and meets EU residency.",
      options: [{ name: "SignalForge", isChosen: true }],
      assumptions: [
        {
          statement: "SignalForge annual cost remains below $25,000",
          metric: "annual_price",
          operator: "<",
          value: 25000,
          unit: "USD/year",
        },
      ],
    });
    decisionB = decB.id;
    await indexDecisionMemory(decB);
  });

  afterAll(async () => {
    for (const id of [tenantA, tenantB]) {
      if (id) await sql`DELETE FROM tenants WHERE id = ${id}`;
    }
    await sql.end();
  });

  it("vector search returns only the querying tenant's rows", async () => {
    const { embedding } = await embedText("SignalForge annual price");
    const { candidates } = await searchMemoryChunks(tenantA, embedding, { limit: 20 });

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.decisionId).not.toBe(decisionB);
    }
  });

  it("hybrid retrieval never surfaces the other tenant's decision", async () => {
    const retrieval = await retrieveMemory(tenantB, "SignalForge annual price", { limit: 20 });
    for (const candidate of retrieval.candidates) {
      expect(candidate.decisionId).not.toBe(decisionA);
    }
  });

  it("getDecisionById refuses a decision belonging to another tenant", async () => {
    expect(await getDecisionById(tenantA, decisionB)).toBeNull();
    expect(await getDecisionById(tenantB, decisionA)).toBeNull();
  });

  it("listDecisions is scoped to the calling tenant", async () => {
    const listA = await listDecisions(tenantA);
    expect(listA.map((d) => d.id)).toContain(decisionA);
    expect(listA.map((d) => d.id)).not.toContain(decisionB);
  });
});
