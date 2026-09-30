import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { githubServerExtensions, WEBHOOK_PATH } from "@decisionloop/github";
import { drainJobs } from "@decisionloop/core/services/worker";
import { splitSqlStatements } from "@decisionloop/storage-sql/migrate";
import { adr018, createTestEnv, workspace, type TestEnv } from "../../core/test/helpers";

const SECRET = "verification-test-secret";
const REPO = "acme/product";
const WORKFLOW = "Authentication integration tests";
const SHA = "a".repeat(40);

describe("decision verification from GitHub workflow runs", () => {
  let env: TestEnv;
  let human: Awaited<ReturnType<typeof workspace>>["human"];
  let agent: Awaited<ReturnType<typeof workspace>>["agent"];
  let tenantId: string;
  let otherTenantId: string;
  let decisionId: string;
  let otherDecisionId: string;
  let ext: ReturnType<typeof githubServerExtensions>;

  beforeAll(async () => {
    env = await createTestEnv();
    const ws = await workspace(env, "Verification Co");
    const other = await workspace(env, "Other Verification Co");
    tenantId = ws.id;
    otherTenantId = other.id;
    human = ws.human;
    agent = ws.agent;
    decisionId = (await env.loop.decisions.create(human, adr018())).id;
    otherDecisionId = (await env.loop.decisions.create(other.human, adr018())).id;
    await env.loop.decisions.configureVerificationCheck(other.human, otherDecisionId, { name: WORKFLOW, repository: REPO });
    await env.loop.store.upsertRepositoryBinding({ tenantId, provider: "github", repository: REPO });
    await env.loop.store.upsertRepositoryBinding({ tenantId, provider: "github", repository: "other/repo" });
    ext = githubServerExtensions(env.loop, { GITHUB_WEBHOOK_SECRET: SECRET }, { client: null });
  });

  afterAll(async () => env.close());

  async function deliver(input: {
    delivery: string;
    repository?: string;
    workflow?: string;
    runId?: number;
    attempt?: number;
    conclusion?: string;
    updatedAt?: string;
  }) {
    const body = JSON.stringify({
      action: "completed",
      repository: { full_name: input.repository ?? REPO },
      sender: { login: "github-actions" },
      workflow_run: {
        id: input.runId ?? 42,
        run_attempt: input.attempt ?? 1,
        name: input.workflow ?? WORKFLOW,
        conclusion: input.conclusion ?? "success",
        head_sha: SHA,
        html_url: "https://github.com/acme/product/actions/runs/42",
        updated_at: input.updatedAt ?? "2026-09-29T01:00:00Z",
      },
    });
    const request = new Request(`http://localhost${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-github-delivery": input.delivery,
        "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`,
      },
      body,
    });
    return ext.routes[0]!(request, new URL(request.url));
  }

  it("lets a person configure by reference, rejects an agent, and enforces the decision limit", async () => {
    await expect(env.loop.decisions.configureVerificationCheck(agent, "ADR-018", { name: WORKFLOW, repository: REPO }))
      .rejects.toMatchObject({ code: "forbidden" });

    const configured = await env.loop.decisions.configureVerificationCheck(human, "ADR-018", {
      name: WORKFLOW,
      repository: "Acme/Product",
      kind: "TEST",
    });
    expect(configured.id).toBe(decisionId);
    expect(configured.verificationChecks).toEqual([{ name: WORKFLOW, repository: REPO, kind: "TEST", description: null }]);

    await env.loop.decisions.configureVerificationCheck(human, "ADR-018", { name: WORKFLOW, repository: REPO });
    const history = await env.loop.decisions.history(human, "ADR-018");
    expect(history.timeline.filter((event) => event.eventType === "VERIFICATION_CHECK_CONFIGURED")).toHaveLength(1);

    const limited = await env.loop.decisions.create(human, adr018({ externalRef: "ADR-MAX" }));
    for (let index = 0; index < 20; index++) {
      await env.loop.decisions.configureVerificationCheck(human, limited.id, { name: `Workflow ${index}`, repository: REPO });
    }
    await expect(env.loop.decisions.configureVerificationCheck(human, limited.id, { name: "Workflow 21", repository: REPO }))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("persists draft links and recovers links stored in the earlier JSON format", async () => {
    const fromDraft = await env.loop.decisions.create(human, adr018({
      externalRef: "ADR-DRAFT",
      verificationChecks: [{ name: "Draft workflow", repository: "Acme/Product", kind: "TEST" }],
    }));
    expect(fromDraft.verificationChecks).toMatchObject([{ name: "Draft workflow", repository: REPO }]);
    expect((await env.loop.store.findDecisionsForVerificationCheck(tenantId, REPO, "Draft workflow")).map((d) => d.id))
      .toContain(fromDraft.id);

    const legacy = await env.loop.decisions.create(human, adr018({ externalRef: "ADR-LEGACY" }));
    const oldChecks = JSON.stringify([{ name: "Legacy workflow", repository: REPO, kind: "TEST" }]);
    await env.sql`
      UPDATE decisions SET metadata = jsonb_build_object('verificationChecks', ${oldChecks}::text)
      WHERE id = ${legacy.id} AND tenant_id = ${tenantId}
    `;
    const migration = fs.readFileSync(path.join(process.cwd(), "db", "migrations", "0009_decision_verification_checks.sql"), "utf8");
    await env.sql.unsafe(splitSqlStatements(migration)[2]!);
    expect((await env.loop.store.getDecision(tenantId, legacy.id))?.verificationChecks)
      .toMatchObject([{ name: "Legacy workflow", repository: REPO }]);

    const legacyRoot = await env.loop.decisions.create(human, adr018({ externalRef: "ADR-LEGACY-ROOT" }));
    const rootJson = JSON.stringify({ verificationChecks: [{ name: "Legacy root", repository: REPO, kind: "BENCHMARK" }] });
    await env.sql`UPDATE decisions SET metadata = ${rootJson}::jsonb WHERE id = ${legacyRoot.id} AND tenant_id = ${tenantId}`;
    await env.sql.unsafe(splitSqlStatements(migration)[2]!);
    expect((await env.loop.store.getDecision(tenantId, legacyRoot.id))?.verificationChecks)
      .toMatchObject([{ name: "Legacy root", repository: REPO, kind: "BENCHMARK" }]);
  });

  it("keeps unrelated runs out, records re-runs, and gives agents commit-specific status", async () => {
    const before = await env.loop.context.getContext(agent, {
      intent: "Change the auth session implementation",
      resources: ["src/auth/session.ts"],
      repository: REPO,
    });
    expect(before.decisions.find((decision) => decision.id === decisionId)?.verificationChecks[0]?.latestRun).toBeNull();
    expect(before.summary).toContain("Verification not yet observed");

    await deliver({ delivery: "unrelated-name", workflow: "Lint", runId: 40 });
    await deliver({ delivery: "unrelated-repository", repository: "other/repo", runId: 41 });
    const worker = env.loop.createWorker({ workerId: "verification-test" }, ext.handlers);
    await drainJobs(worker);
    expect(await env.loop.store.listVerificationRuns(tenantId, { decisionIds: [decisionId] })).toHaveLength(0);

    const first = await deliver({ delivery: "run-one", conclusion: "success" });
    expect(first?.status).toBe(202);
    const duplicate = await deliver({ delivery: "run-one", conclusion: "success" });
    expect(await duplicate?.json()).toMatchObject({ duplicate: true });
    await drainJobs(worker);

    await deliver({ delivery: "run-two", attempt: 2, conclusion: "failure", updatedAt: "2026-09-29T02:00:00Z" });
    await drainJobs(worker);
    await deliver({ delivery: "startup-failure", runId: 43, conclusion: "startup_failure", updatedAt: "2026-09-29T00:30:00Z" });
    await drainJobs(worker);
    const history = await env.loop.decisions.history(human, "ADR-018");
    expect(history.verificationRuns.map((run) => run.sourceRunId)).toEqual(["42:2", "42:1", "43:1"]);
    expect(history.latestVerificationRuns[0]).toMatchObject({ conclusion: "failure", commitSha: SHA, repository: REPO });
    expect(history.decision.status).toBe("ACTIVE");
    expect(await env.loop.store.listVerificationRuns(otherTenantId, { decisionIds: [decisionId] })).toHaveLength(0);
    expect(await env.loop.store.listVerificationRuns(otherTenantId, { decisionIds: [otherDecisionId] })).toHaveLength(0);

    const after = await env.loop.context.getContext(agent, {
      intent: "Change the auth session implementation",
      resources: ["src/auth/session.ts"],
      repository: REPO,
    });
    expect(after.decisions.find((decision) => decision.id === decisionId)?.verificationChecks[0]?.latestRun?.conclusion).toBe("failure");
    expect(after.summary).toContain(`was failure on commit ${SHA.slice(0, 12)}`);
    expect(after.summary).toContain("does not establish the status of a different commit");

    const [run] = await env.sql`SELECT details FROM agent_runs WHERE id = ${after.contextRequestId}`;
    const details = typeof run?.details === "string" ? JSON.parse(run.details) : run?.details;
    expect((details as { provided: Array<{ verificationChecks: Array<{ latestRun: { conclusion: string } }> }> })
      .provided.find((decision) => decision.verificationChecks.length > 0)?.verificationChecks[0]?.latestRun.conclusion).toBe("failure");
  });
});
