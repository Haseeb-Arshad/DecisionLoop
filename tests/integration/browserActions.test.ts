import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createTestEnv,
  workspace,
  type TestEnv,
} from "@/packages/core/test/helpers";
import { setDecisionLoop } from "@/lib/decisionloopInstance";
import { takeRequestLimit } from "@decisionloop/runtime/requestLimits";
import { workerHeartbeat } from "@decisionloop/runtime/heartbeat";
import {
  selectEmbeddingProvider,
  selectReasoningProvider,
} from "@decisionloop/providers";

const identity = vi.hoisted(() => ({ tenantId: "", userId: "" }));
vi.mock("@/lib/auth/currentUser", () => ({
  requireAuth: async () => ({
    tenantId: identity.tenantId,
    sessionId: "browser-regression",
    user: { id: identity.userId, name: "Reviewer" },
  }),
  UnauthenticatedError: class extends Error {},
}));
import { POST as resolve } from "@/app/api/conflicts/[id]/resolve/route";

let env: TestEnv;
let ws: Awaited<ReturnType<typeof workspace>>;
beforeAll(async () => {
  env = await createTestEnv();
  ws = await workspace(env, "Browser regression");
  const [user] =
    await env.sql`INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES (${ws.id}, ${`regression-${ws.id}@example.test`}, 'unused', 'Reviewer', 'owner') RETURNING id`;
  identity.tenantId = ws.id;
  identity.userId = user!.id;
  setDecisionLoop(env.loop);
});
afterAll(async () => {
  setDecisionLoop(null);
  await env.close();
});

describe("browser readiness regressions", () => {
  it("dismissing one of two conflicts on the same condition keeps the decision at risk", async () => {
    const decision = await env.loop.decisions.create(ws.human, {
      title: "Browser conflict review",
      chosenOption: { name: "Redis" },
      assumptions: [
        {
          statement: "Latency remains below 20 ms",
          subject: "service:browser-cache",
          predicate: "latency",
          valueType: "NUMBER",
          operator: "<",
          expected: 20,
          unit: "ms",
          authority: 1,
        },
      ],
    });
    for (const value of [30, 40]) {
      await env.loop.evidence.ingest(ws.id, {
        source: "browser-test",
        externalId: `${decision.id}-${value}`,
        type: "metric.observed",
        occurredAt: new Date().toISOString(),
        actor: { type: "user", label: "Reviewer" },
        provenance: { receivedVia: "test", authority: 0.8 },
        facts: [
          {
            subject: "service:browser-cache",
            predicate: "latency",
            valueType: "NUMBER",
            value,
            unit: "ms",
            statement: `Latency is ${value} ms`,
          },
        ],
      });
      await env.drain();
    }
    const conflicts = await env.loop.store.listConflicts(ws.id, {
      decisionId: decision.id,
      unresolvedOnly: true,
    });
    expect(conflicts).toHaveLength(2);
    const response = await resolve(
      new NextRequest("http://localhost/api/conflicts/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolution: "dismiss",
          note: "First observation was stale.",
        }),
      }),
      { params: Promise.resolve({ id: conflicts[0]!.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision.status).toBe("AT_RISK");
    expect(body.decision.assumptions[0].validityStatus).toBe("CHALLENGED");
    expect(
      await env.loop.store.listConflicts(ws.id, {
        decisionId: decision.id,
        unresolvedOnly: true,
      }),
    ).toHaveLength(1);
    const repeated = await resolve(
      new NextRequest("http://localhost/api/conflicts/resolve", {
        method: "POST",
        body: JSON.stringify({ resolution: "dismiss" }),
      }),
      { params: Promise.resolve({ id: conflicts[0]!.id }) },
    );
    expect(repeated.status).toBe(400);
  });
  it("request budgets survive a new caller and are isolated by key", async () => {
    const key = `test-limit:${ws.id}`;
    expect(await takeRequestLimit(env.sql, key, 2)).toBe(true);
    expect(await takeRequestLimit(env.sql, key, 2)).toBe(true);
    expect(await takeRequestLimit(env.sql, key, 2)).toBe(false);
    expect(await takeRequestLimit(env.sql, key + ":other", 2)).toBe(true);
  });
  it("persists a heartbeat that the control plane can observe", async () => {
    const workerId = `heartbeat-test-${ws.id}`;
    await workerHeartbeat(env.sql, workerId).run();
    const [row] =
      await env.sql`SELECT worker_id FROM worker_heartbeats WHERE worker_id = ${workerId}`;
    expect(row?.worker_id).toBe(workerId);
    await env.sql`DELETE FROM worker_heartbeats WHERE worker_id = ${workerId}`;
  });
  it("blank optional provider settings use offline defaults", () => {
    expect(
      selectReasoningProvider({ DECISIONLOOP_REASONING_PROVIDER: " " }).name,
    ).toBe("none");
    expect(
      selectEmbeddingProvider({ DECISIONLOOP_EMBEDDING_PROVIDER: " " })
        .modelName,
    ).toContain("lexical");
  });
});
