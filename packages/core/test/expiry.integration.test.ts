import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, workspace, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe("temporal validity: expired assumptions are challenged, not invalidated", () => {
  it("challenges exactly the expired assumptions, once, within their own tenant", async () => {
    const a = await workspace(env, "Expiry A");
    const b = await workspace(env, "Expiry B");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString();

    const d = await env.loop.decisions.create(a.human, {
      title: "Stay on the 2026 vendor contract",
      chosenOption: { name: "Renew" },
      assumptions: [
        { statement: "Contract pricing holds", validUntil: yesterday },
        { statement: "Vendor remains SOC2 certified", validUntil: nextYear },
      ],
    });
    const other = await env.loop.decisions.create(b.human, {
      title: "Other tenant decision",
      chosenOption: { name: "X" },
      assumptions: [{ statement: "Something that expired", validUntil: yesterday }],
    });

    const first = await env.loop.expiry.sweep();
    expect(first.challenged).toEqual(expect.arrayContaining([d.assumptions[0]!.id, other.assumptions[0]!.id]));
    expect(first.challenged).not.toContain(d.assumptions[1]!.id);

    const after = (await env.loop.store.getDecision(a.id, d.id))!;
    expect(after.status).toBe("AT_RISK");
    expect(after.assumptions.map((x) => x.validityStatus)).toEqual(["CHALLENGED", "VALID"]);
    const [conflict] = await env.loop.store.listConflicts(a.id, { decisionId: d.id });
    expect(conflict).toMatchObject({ conflictType: "ASSUMPTION_EXPIRED", detectionMethod: "DETERMINISTIC" });
    // The other tenant's conflict lives in the other tenant only.
    expect(await env.loop.store.listConflicts(a.id, { decisionId: other.id })).toEqual([]);
    expect(await env.loop.store.listConflicts(b.id, { decisionId: other.id })).toHaveLength(1);

    const second = await env.loop.expiry.sweep();
    expect(second.challenged).not.toContain(d.assumptions[0]!.id);
    expect(await env.loop.store.listConflicts(a.id, { decisionId: d.id })).toHaveLength(1);
  });

  it("is available as a durable job", async () => {
    await env.loop.store.enqueueJob({ tenantId: null, kind: "sweep_expired_assumptions", payload: {}, dedupeKey: `test-sweep-${Date.now()}` });
    expect(await env.drain()).toBeGreaterThanOrEqual(1);
  });
});
