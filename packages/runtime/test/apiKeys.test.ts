import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, workspace, type TestEnv } from "../../core/test/helpers";
import { authenticateApiKey, issueApiKey } from "../src/apiKeys";

let env: TestEnv;
let ws: Awaited<ReturnType<typeof workspace>>;

beforeAll(async () => {
  env = await createTestEnv();
  ws = await workspace(env, "Keys Co");
});
afterAll(async () => env.close());

describe("source-bound integration keys", () => {
  it("authenticates as the bound source", async () => {
    const { key } = await issueApiKey(env.loop.store, { tenantId: ws.id, name: "erp", scopes: ["read", "propose"], actorType: "integration", eventSource: "procurement" });
    const actor = await authenticateApiKey(env.loop.store, key);
    expect(actor).toMatchObject({ type: "integration", eventSource: "procurement", tenantId: ws.id });
  });

  it("leaves other keys unbound", async () => {
    const { key } = await issueApiKey(env.loop.store, { tenantId: ws.id, name: "bot", scopes: ["read"], actorType: "agent" });
    expect((await authenticateApiKey(env.loop.store, key))?.eventSource).toBeNull();
  });

  it("refuses names the platform uses, so a key cannot borrow their trust", async () => {
    for (const source of ["github", "human", "agent", "api", "document"]) {
      await expect(issueApiKey(env.loop.store, { tenantId: ws.id, name: "x", scopes: ["propose"], actorType: "integration", eventSource: source })).rejects.toThrow(/reserved/);
    }
  });

  it("refuses malformed names and non-integration keys", async () => {
    await expect(issueApiKey(env.loop.store, { tenantId: ws.id, name: "x", scopes: ["propose"], actorType: "integration", eventSource: "Bad Name!" })).rejects.toThrow(/2-40/);
    await expect(issueApiKey(env.loop.store, { tenantId: ws.id, name: "x", scopes: ["propose"], actorType: "agent", eventSource: "erp" })).rejects.toThrow(/integration/);
  });
});
