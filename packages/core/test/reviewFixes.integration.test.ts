import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, workspace, type TestEnv } from "./helpers";

let env: TestEnv;
let ws: Awaited<ReturnType<typeof workspace>>;
beforeAll(async () => {
  env = await createTestEnv();
  ws = await workspace(env, "Review Fixes");
});
afterAll(async () => env.close());

const metric = (externalId: string, subject: string, predicate: string, value: number, authority: number) => ({
  source: "metrics",
  externalId,
  type: "metric.threshold",
  occurredAt: new Date().toISOString(),
  actor: { type: "integration" as const, label: "grafana" },
  facts: [{ subject, predicate, valueType: "NUMBER" as const, value, statement: `${predicate} is ${value}` }],
  provenance: { receivedVia: "test", authority },
});

describe("evidence identity", () => {
  it("the same content carried by a later, stronger event is evaluated again", async () => {
    const d = await env.loop.decisions.create(ws.human, {
      title: "Nightly exports",
      chosenOption: { name: "Cron" },
      assumptions: [{ statement: "Exports stay under 1 GB", subject: "service:exports", predicate: "export_size_gb", valueType: "NUMBER", operator: "<", expected: 1 }],
    });
    // Identical facts, two different events: a weak first report, then a strong one.
    const first = await env.loop.evidence.ingest(ws.id, metric("r1", "service:exports", "export_size_gb", 7, 0.3));
    await env.drain();
    const second = await env.loop.evidence.ingest(ws.id, metric("r2", "service:exports", "export_size_gb", 7, 0.95));
    await env.drain();
    const e1 = await env.loop.store.listEvaluations(ws.id, { eventId: first.event.id });
    const e2 = await env.loop.store.listEvaluations(ws.id, { eventId: second.event.id });
    expect(e1[0]?.nextValidity).toBe("CHALLENGED");
    expect(e2[0]?.nextValidity).toBe("INVALIDATED");
    expect((await env.loop.store.getDecision(ws.id, d.id))!.assumptions[0]!.validityStatus).toBe("INVALIDATED");
  });
});

describe("dismissing a later conflict", () => {
  it("does not undo an invalidation a person already accepted", async () => {
    const d = await env.loop.decisions.create(ws.human, {
      title: "Batch size",
      chosenOption: { name: "Fixed" },
      assumptions: [{ statement: "Batches stay under 10 items", subject: "service:batch", predicate: "batch_items", valueType: "NUMBER", operator: "<", expected: 10 }],
    });
    // Two open conflicts on one assumption: a weak report (challenge), then a strong one.
    await env.loop.evidence.ingest(ws.id, metric("b1", "service:batch", "batch_items", 50, 0.3));
    await env.drain();
    await env.loop.evidence.ingest(ws.id, metric("b2", "service:batch", "batch_items", 70, 0.95));
    await env.drain();
    const open = await env.loop.store.listConflicts(ws.id, { decisionId: d.id, unresolvedOnly: true });
    expect(open).toHaveLength(2);
    const [newer, older] = open; // newest first
    await env.loop.conflicts.accept(ws.human, older!.id);
    await env.loop.conflicts.dismiss(ws.human, newer!.id);
    expect((await env.loop.store.getDecision(ws.id, d.id))!.assumptions[0]!.validityStatus).toBe("INVALIDATED");
  });
});

describe("concurrent event processing", () => {
  it("only one processor evaluates an event; the other returns its result", async () => {
    await env.loop.decisions.create(ws.human, {
      title: "Cache TTL",
      chosenOption: { name: "60s" },
      assumptions: [{ statement: "TTL stays at least 30s", subject: "service:cache", predicate: "ttl_seconds", valueType: "NUMBER", operator: ">=", expected: 30 }],
    });
    const { event } = await env.loop.evidence.ingest(ws.id, metric("ttl-1", "service:cache", "ttl_seconds", 5, 0.9));
    const [r1, r2] = await Promise.all([env.loop.triggers.process(ws.id, event.id), env.loop.triggers.process(ws.id, event.id)]);
    expect(r2.conflictIds).toEqual(r1.conflictIds);
    expect(await env.loop.store.listEvaluations(ws.id, { eventId: event.id })).toHaveLength(1);
  });
});

describe("job dead-lettering", () => {
  it("a job that used its attempts before its worker died goes to DEAD, not back to the queue", async () => {
    const { job } = await env.loop.store.enqueueJob({ tenantId: ws.id, kind: "test.crash", payload: {}, maxAttempts: 1 });
    await env.loop.store.claimJobs("crashy", 1, { kinds: ["test.crash"] });
    const again = await env.loop.store.claimJobs("w2", 1, { kinds: ["test.crash"], lockTimeoutMs: -1 });
    expect(again).toEqual([]);
    expect((await env.loop.store.getJob(job.id))?.status).toBe("DEAD");
  });
});

describe("context options", () => {
  it("includeSuperseded returns superseded decisions", async () => {
    const old = await env.loop.decisions.create(ws.human, { title: "Old flags", chosenOption: { name: "YAML" }, resources: ["src/flags/**"], repository: "acme/x" });
    const next = await env.loop.decisions.create(ws.human, { title: "New flags", chosenOption: { name: "Service" }, resources: ["src/newflags/**"], repository: "acme/x" });
    await env.loop.decisions.supersede(ws.human, old.id, next.id);
    const req = { intent: "change flags", resources: ["src/flags/a.yaml"], repository: "acme/x" };
    const without = await env.loop.context.getContext(ws.agent, req);
    const withOld = await env.loop.context.getContext(ws.agent, { ...req, includeSuperseded: true });
    expect(without.decisions.map((d) => d.id)).not.toContain(old.id);
    expect(withOld.decisions.map((d) => d.id)).toContain(old.id);
  });
});
