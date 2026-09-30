import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRuntime, issueApiKey, type Runtime } from "@decisionloop/runtime";
import { startServer, type ServerHandle } from "@decisionloop/runtime/server";
import { DecisionLoop, DecisionLoopApiError } from "@decisionloop/sdk";
import { adr018 } from "../../core/test/helpers";

let runtime: Runtime;
let server: ServerHandle;
let tenantId: string;
let humanKey: string;
let agentKey: string;

beforeAll(async () => {
  runtime = await createRuntime({ databaseUrl: process.env.DATABASE_URL, poolMax: 1 });
  tenantId = (await runtime.loop.store.createWorkspace("HTTP Test")).id;
  humanKey = (await issueApiKey(runtime.loop.store, { tenantId, name: "alice-cli", scopes: ["admin"], actorType: "user" })).key;
  agentKey = (await issueApiKey(runtime.loop.store, { tenantId, name: "claude-code", scopes: ["read", "propose"], actorType: "agent" })).key;
  server = await startServer(runtime, { port: 0 });
});

afterAll(async () => {
  await server?.close();
  await runtime.sql`DELETE FROM jobs WHERE tenant_id = ${tenantId}`;
  await runtime.sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  await runtime.stop();
});

async function mcpClient(key: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}`, "x-decisionloop-agent": "claude-code", "x-decisionloop-session": "sess-mcp-1" } },
    }),
  );
  return client;
}

describe("HTTP API + SDK", () => {
  it("rejects missing and forged credentials", async () => {
    const res = await fetch(`${server.url}/api/v1/me`);
    expect(res.status).toBe(401);
    const forged = new DecisionLoop({ baseUrl: server.url, apiKey: "dl_aaaaaaaa_" + "x".repeat(43) });
    await expect(forged.operations.whoami()).rejects.toMatchObject({ status: 401 });
  });

  it("a person commits; an agent reads context, proposes, and cannot commit", async () => {
    const human = new DecisionLoop({ baseUrl: server.url, apiKey: humanKey });
    const adr = await human.decisions.create(adr018());
    expect(adr.status).toBe("ACTIVE");

    const agent = new DecisionLoop({ baseUrl: server.url, apiKey: agentKey, agent: { name: "claude-code", sessionId: "sess-sdk-1", repository: "acme/product" } });
    const ctx = await agent.context.get({ intent: "replace authentication implementation", resources: ["src/auth/**"], repository: "acme/product" });
    expect(ctx.decisions[0]?.externalRef).toBe("ADR-018");

    const { decision, approval } = await agent.decisions.propose({
      title: "Switch to stateless JWT",
      chosenOption: { name: "Stateless JWT" },
      resources: ["src/auth/**"],
      repository: "acme/product",
    });
    expect(approval.status).toBe("PENDING");
    await expect(agent.decisions.commit(decision.id)).rejects.toMatchObject({ code: "approval_required" });
    await expect(human.approvals.resolve(approval.id, "reject", "still need revocation")).resolves.toMatchObject({ status: "REJECTED" });

    const constraints = await agent.context.constraints(["npm:redis"]);
    expect(constraints[0]?.decision.externalRef).toBe("ADR-018");
  });

  it("lets a person link a workflow over HTTP and denies an agent", async () => {
    const human = new DecisionLoop({ baseUrl: server.url, apiKey: humanKey });
    const agent = new DecisionLoop({ baseUrl: server.url, apiKey: agentKey });
    const check = { name: "Authentication integration tests", repository: "Acme/Product", kind: "TEST" as const };
    const configured = await human.decisions.configureVerificationCheck("ADR-018", check);
    expect(configured.verificationChecks).toMatchObject([{ name: check.name, repository: "acme/product" }]);
    expect((await human.decisions.get("ADR-018")).decision.verificationChecks).toMatchObject([{ name: check.name }]);
    await expect(agent.decisions.configureVerificationCheck("ADR-018", check)).rejects.toMatchObject({ status: 403 });
  });

  it("evidence is processed by the server's worker, asynchronously", async () => {
    const agent = new DecisionLoop({ baseUrl: server.url, apiKey: agentKey });
    const r = await agent.evidence.add({
      statement: "Staging load test: Redis p95 lookup is 31 ms",
      facts: [{ subject: "infrastructure:redis", predicate: "p95_latency_ms", valueType: "NUMBER", value: 31, unit: "ms", statement: "p95 31ms" }],
    });
    expect(r.created).toBe(true);
    let status = "";
    for (let i = 0; i < 40 && status !== "PROCESSED"; i++) {
      await new Promise((res) => setTimeout(res, 250));
      status = (await agent.evidence.status(r.eventId)).status;
    }
    expect(status).toBe("PROCESSED");
    const human = new DecisionLoop({ baseUrl: server.url, apiKey: humanKey });
    const adr = await human.decisions.get("ADR-018");
    // Agent evidence: challenged, not invalidated.
    expect(adr.decision.assumptions.find((a) => a.predicate === "p95_latency_ms")?.validityStatus).toBe("CHALLENGED");
    expect(adr.decision.status).toBe("AT_RISK");
  });

  it("invalid input is a 400 with details, not a 500", async () => {
    const human = new DecisionLoop({ baseUrl: server.url, apiKey: humanKey });
    await expect(human.decisions.propose({ title: "" } as never)).rejects.toMatchObject({ status: 400, code: "invalid" });
  });
});

describe("MCP over streamable HTTP", () => {
  it("an agent credential sees read and propose tools, never the authoritative ones", async () => {
    const client = await mcpClient(agentKey);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["decisionloop_get_context", "decisionloop_propose_decision", "decisionloop_add_evidence"]));
    expect(names).not.toContain("decisionloop_commit_decision");
    expect(names).not.toContain("decisionloop_dismiss_conflict");
    expect(names).not.toContain("decisionloop_configure_verification_check");
    const readOnly = (await client.listTools()).tools.find((t) => t.name === "decisionloop_get_context")!;
    expect(readOnly.annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  it("a person's credential sees the sensitive tools too", async () => {
    const client = await mcpClient(humanKey);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("decisionloop_commit_decision");
    expect(names).toContain("decisionloop_configure_verification_check");
    await client.close();
  });

  it("get_context over MCP returns the reasoning, flags risk, and is recorded against the agent session", async () => {
    const client = await mcpClient(agentKey);
    const result = await client.callTool({
      name: "decisionloop_get_context",
      arguments: { intent: "Refactor session handling", resources: ["src/auth/session.ts"], repository: "acme/product" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("ADR-018");
    expect(text).toContain("AT RISK");
    expect(text).toContain("Rejected: Stateless JWT");
    await client.close();

    const human = new DecisionLoop({ baseUrl: server.url, apiKey: humanKey });
    const sessions = await human.operations.listSessions();
    const s = sessions.find((x) => x.externalSessionId === "sess-mcp-1")!;
    expect(s.agent).toBe("claude-code");
    const inspected = (await human.operations.inspectSession(s.id)) as { contextRequests: Array<{ decisions: Array<{ externalRef: string; status: string }> }> };
    expect(inspected.contextRequests[0]!.decisions[0]!.externalRef).toBe("ADR-018");
    // Point in time: the status the agent was shown.
    expect(inspected.contextRequests[0]!.decisions[0]!.status).toBe("AT_RISK");
  });

  it("tool errors are reported as MCP errors, not transport failures", async () => {
    const client = await mcpClient(agentKey);
    const result = await client.callTool({ name: "decisionloop_get_decision", arguments: { id: "ADR-999" } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/not_found/);
    await client.close();
  });
});

describe("overview", () => {
  it("reports real counts for the control plane", async () => {
    const o = await new DecisionLoop({ baseUrl: server.url, apiKey: humanKey }).operations.getOverview();
    expect(o.decisions.ACTIVE ?? 0).toBeGreaterThanOrEqual(0);
    expect(o.assumptions.CHALLENGED).toBeGreaterThanOrEqual(1);
    expect(o.contextRequestsSince).toBeGreaterThanOrEqual(1);
    expect(o.recentRecalls[0]?.decisions[0]?.externalRef).toBe("ADR-018");
  });
});
