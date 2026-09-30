import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createTestEnv,
  workspace,
  type TestEnv,
} from "@/packages/core/test/helpers";
vi.mock("@/lib/auth/session", () => ({
  createSession: async () => "test-session",
  setSessionCookie: async () => undefined,
}));
import { GET, POST } from "@/app/api/auth/signup/route";
let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterEach(() => {
  globalThis.__decisionloop_local_workspace__ = undefined;
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await env.close();
});
function request(email: string) {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceName: "Requested name",
      name: "Local reviewer",
      email,
      password: "LocalRegression-2026-Test",
    }),
  });
}
it("hosted registration is closed by default in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DECISIONLOOP_ALLOW_SIGNUP", "false");
  expect((await (await GET()).json()).available).toBe(false);
  expect((await POST(request("closed@example.test"))).status).toBe(403);
});
it("local bootstrap shares the CLI tenant and creates only one owner under simultaneous signup", async () => {
  const ws = await workspace(env, "Local shared workspace");
  globalThis.__decisionloop_local_workspace__ = ws.id;
  vi.stubEnv("NODE_ENV", "production");
  const setup = await (await GET()).json();
  expect(setup).toMatchObject({
    available: true,
    local: true,
    workspaceName: "Local shared workspace",
  });
  const responses = await Promise.all([
    POST(request(`first-${ws.id}@example.test`)),
    POST(request(`second-${ws.id}@example.test`)),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
  const body = await responses.find((r) => r.status === 200)!.json();
  expect(body.tenant.id).toBe(ws.id);
  expect(body.user.tenantId).toBe(ws.id);
  const [count] =
    await env.sql`SELECT count(*) AS n FROM users WHERE tenant_id = ${ws.id}`;
  expect(Number(count?.n)).toBe(1);
  expect((await (await GET()).json()).available).toBe(false);
});
