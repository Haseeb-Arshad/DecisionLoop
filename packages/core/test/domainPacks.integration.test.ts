import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, workspace, type TestEnv } from "./helpers";

/** The same engine across verticals: only vocabulary, extractors, authority and policies differ. */

let env: TestEnv;
let ws: Awaited<ReturnType<typeof workspace>>;

beforeAll(async () => {
  env = await createTestEnv();
  ws = await workspace(env, "Packs Co");
});
afterAll(async () => env.close());

async function ingest(source: string, type: string, payload: Record<string, unknown>, id: string) {
  const { event } = await env.loop.evidence.ingest(ws.id, {
    source,
    externalId: id,
    type,
    occurredAt: new Date().toISOString(),
    actor: { type: "integration", label: source },
    payload,
    provenance: { receivedVia: "test" },
  });
  await env.drain();
  return (await env.loop.store.getEvent(ws.id, event.id))!;
}

describe("procurement pack", () => {
  it("a supplier quote invalidates a price assumption — including one stored under a 1.x alias", async () => {
    const d = await env.loop.decisions.create(ws.human, {
      title: "Source enclosures from Supplier A",
      domain: "procurement",
      chosenOption: { name: "Supplier A" },
      alternatives: [{ name: "Supplier B", rejectionReason: "Longer lead time" }],
      assumptions: [
        { statement: "Unit cost stays under $3.20", subject: "supplier:supplier_a", predicate: "unit_cost", valueType: "NUMBER", operator: "<", expected: 3.2, unit: "USD/unit", authority: 0.8 },
        { statement: "Annual spend stays under $40k", subject: "vendor:supplier_a", predicate: "annual_price", valueType: "NUMBER", operator: "<", expected: 40000, unit: "USD/year", authority: 0.8 },
        { statement: "Lead time under 14 days", subject: "vendor:supplier_a", predicate: "lead_time", valueType: "NUMBER", operator: "<", expected: 14, unit: "days" },
      ],
      resources: ["vendor:supplier_a"],
    });
    const event = await ingest("procurement", "quote.received", { quote: { vendor: "Supplier A", unitPrice: 4.7, annualCost: 61000, leadTimeDays: 10 } }, "quote-1");
    const after = (await env.loop.store.getDecision(ws.id, d.id))!;
    expect(after.assumptions.map((a) => a.validityStatus)).toEqual(["INVALIDATED", "INVALIDATED", "VALID"]);
    expect(after.status).toBe("AT_RISK");
    const evals = await env.loop.store.listEvaluations(ws.id, { eventId: event.id });
    expect(evals.find((e) => e.nextValidity === "INVALIDATED")?.evidenceAuthority).toBe(0.85);
    expect(evals.some((e) => e.relation === "SUPPORTS")).toBe(true); // lead time 10 < 14
  });
});

describe("product pack", () => {
  it("an analytics snapshot contradicts a prioritisation assumption", async () => {
    const d = await env.loop.decisions.create(ws.human, {
      title: "Do not build Android yet",
      domain: "product",
      chosenOption: { name: "iOS + web only" },
      assumptions: [{ statement: "Android demand under 10%", subject: "platform:mobile", predicate: "android_demand_share", valueType: "NUMBER", operator: "<", expected: 0.1 }],
      resources: ["platform:mobile"],
    });
    await ingest("analytics", "metric.snapshot", { metrics: [{ subject: "platform:mobile", metric: "android_share", value: 0.31 }] }, "snap-1");
    expect((await env.loop.store.getDecision(ws.id, d.id))!.assumptions[0]!.validityStatus).toBe("INVALIDATED");
  });
});

describe("finance pack", () => {
  it("any change to a finance assumption requires human review, even from approved reports", async () => {
    const d = await env.loop.decisions.create(ws.human, {
      title: "Expand product line A",
      domain: "finance",
      importance: 0.5, // below the generic high-impact threshold
      chosenOption: { name: "Expand" },
      assumptions: [{ statement: "Gross margin above 35%", subject: "business_unit:line_a", predicate: "gross_margin_pct", valueType: "NUMBER", operator: ">", expected: 35 }],
      resources: ["business_unit:line_a"],
    });
    const event = await ingest("finance", "report.approved", { metrics: [{ subject: "business_unit:line_a", metric: "gross_margin", value: 24 }] }, "q3-report");
    const [evaluation] = await env.loop.store.listEvaluations(ws.id, { eventId: event.id });
    expect(evaluation).toMatchObject({ nextValidity: "INVALIDATED", evidenceAuthority: 0.95 });
    expect(evaluation!.matchedPolicies).toContain("finance_material_review");
    const reviews = await env.loop.store.listApprovals(ws.id, { status: "PENDING", decisionId: d.id });
    expect(reviews.some((a) => a.kind === "REVIEW_CONFLICT")).toBe(true);
  });
});
