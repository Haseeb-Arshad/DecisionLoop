import { diffPackageJson, type ChangedFile, type DependencyChange } from "@decisionloop/core/domain-packs/engineering";
import type { ContextResponse } from "@decisionloop/core/services/context";
import type { DecisionLoop } from "@decisionloop/core/services/index";
import type { TriggerResult } from "@decisionloop/core/services/triggers";
import { PermanentJobError, type JobHandler } from "@decisionloop/core/services/worker";
import type { Actor } from "@decisionloop/core/types/records";
import { GithubClient, appAuth, patAuth } from "./client";
import { RELEVANT_EVENT_TYPES, eventTypeOf, normalizeGithubEvent, verifyGithubSignature, type GithubPayload } from "./webhook";

export * from "./client";
export * from "./webhook";

export const ADVISORY_MARKER = "<!-- decisionloop:advisory -->";
export const WEBHOOK_PATH = "/api/integrations/github/webhook";

type Env = Record<string, string | undefined>;

/**
 * The advisory PR comment (spec §11). Deliberately plain and short, and
 * advisory only: it never blocks a merge. Every finding carries its id so a
 * false positive can be dismissed and counted.
 */
export function renderAdvisoryComment(input: { context: ContextResponse; result: TriggerResult; prUrl?: string | null }): string | null {
  const { context, result } = input;
  const findings = result.constraintFindings;
  const relevant = context.decisions.filter((d) => d.relevance >= 0.5);
  const atRisk = relevant.filter((d) => d.status === "AT_RISK");
  if (findings.length === 0 && relevant.length === 0) return null;

  const lines: string[] = [ADVISORY_MARKER, "### DecisionLoop"];
  const n = relevant.length;
  lines.push(
    n
      ? `DecisionLoop found ${n === 1 ? "one relevant decision" : `${n} relevant decisions`} for the code this PR changes.`
      : "DecisionLoop found a recorded constraint this PR may affect.",
  );

  for (const f of findings) {
    const d = context.decisions.find((x) => x.id === f.decisionId);
    lines.push("");
    lines.push(`**${d?.externalRef ?? d?.title ?? f.decisionId}** — ${f.statement}`);
    if (d?.chosen) lines.push(`It chose *${d.chosen}*${d.rationale ? ` because: ${d.rationale.split(/(?<=\.)\s/)[0]}` : "."}`);
    lines.push(`This PR: ${f.explanation}`);
    const unchanged = (d?.assumptions ?? []).filter(
      (a) => a.validity === "VALID" && !result.evaluations.some((e) => e.assumptionId === a.id && e.relation === "CONTRADICTS"),
    );
    if (unchanged.length) {
      lines.push(`No evidence in this PR indicates that these still-recorded assumptions changed: ${unchanged.map((a) => `“${a.statement}”`).join("; ")}.`);
    }
    lines.push(`Review recommended. <sub>finding \`${f.findingId}\`</sub>`);
  }

  const others = relevant.filter((d) => !findings.some((f) => f.decisionId === d.id));
  if (others.length) {
    lines.push("");
    lines.push("Also relevant:");
    for (const d of others.slice(0, 5)) {
      lines.push(`- **${d.externalRef ?? d.title}** [${d.status}]${d.chosen ? ` — chose ${d.chosen}` : ""}`);
    }
  }
  if (atRisk.length) {
    lines.push("");
    lines.push(`⚠ ${atRisk.map((d) => d.externalRef ?? d.title).join(", ")} ${atRisk.length === 1 ? "is" : "are"} already AT RISK: newer evidence contradicts an assumption.`);
  }
  lines.push("");
  lines.push("<sub>Advisory only — this does not block merging. If a finding is wrong, dismiss it in DecisionLoop; dismissals are tracked as false positives.</sub>");
  return lines.join("\n");
}

function githubClient(env: Env): GithubClient | null {
  const api = env.GITHUB_API_URL ?? "https://api.github.com";
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) return new GithubClient(appAuth(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, api), api);
  if (env.GITHUB_TOKEN) return new GithubClient(patAuth(env.GITHUB_TOKEN), api);
  return null;
}

/**
 * Webhook route + worker job. The route only verifies, routes to a
 * workspace and enqueues (fast 202); fetching files, evaluating and
 * commenting happen on the worker with retries.
 */
export function githubServerExtensions(loop: DecisionLoop, env: Env = process.env, opts: { client?: GithubClient | null } = {}) {
  const secret = env.GITHUB_WEBHOOK_SECRET ?? "";
  const client = opts.client !== undefined ? opts.client : githubClient(env);

  const route = async (req: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== WEBHOOK_PATH) return null;
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if (!secret) return Response.json({ error: "GITHUB_WEBHOOK_SECRET is not configured." }, { status: 503 });
    const raw = await req.text();
    if (raw.length > 5_000_000) return Response.json({ error: "Payload too large." }, { status: 413 });
    if (!verifyGithubSignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
      return Response.json({ error: "Invalid signature." }, { status: 401 });
    }
    const event = req.headers.get("x-github-event") ?? "";
    const deliveryId = req.headers.get("x-github-delivery") ?? "";
    if (!deliveryId) return Response.json({ error: "Missing delivery id." }, { status: 400 });
    const payload = JSON.parse(raw) as GithubPayload;
    const type = eventTypeOf(event, payload);
    if (!RELEVANT_EVENT_TYPES.has(type)) return Response.json({ ignored: type }, { status: 202 });
    const repo = payload.repository?.full_name;
    const binding = repo ? await loop.store.findRepositoryBinding("github", repo) : null;
    if (!binding) return Response.json({ ignored: "repository not bound to a workspace" }, { status: 202 });
    const { job, created } = await loop.store.enqueueJob({
      tenantId: binding.tenantId,
      kind: "github_event",
      payload: {
        tenantId: binding.tenantId,
        installationId: binding.installationId ?? (payload.installation?.id ? String(payload.installation.id) : null),
        advisory: binding.advisoryMode,
        event,
        deliveryId,
        payload,
      },
      // GitHub redelivers on timeouts; the delivery id makes that a no-op.
      dedupeKey: `github:${deliveryId}`,
    });
    return Response.json({ accepted: true, jobId: job.id, duplicate: !created }, { status: 202 });
  };

  const handler: JobHandler = async (job) => {
    const p = job.payload as {
      tenantId: string;
      installationId: string | null;
      advisory: boolean;
      event: string;
      deliveryId: string;
      payload: GithubPayload;
    };
    if (!p.tenantId || !p.deliveryId) throw new PermanentJobError("github_event job is missing tenant or delivery id.");
    const repo = p.payload.repository?.full_name ?? "";
    const pr = p.payload.pull_request;

    // Enrich: which files changed, and how dependencies moved.
    let changedFiles: ChangedFile[] | undefined;
    let dependencyChanges: DependencyChange[] | undefined;
    if (pr && client) {
      const files = await client.listPullRequestFiles(p.installationId, repo, pr.number);
      changedFiles = files.map((f) => ({ path: f.filename, status: (f.status === "removed" ? "removed" : f.status === "added" ? "added" : f.status === "renamed" ? "renamed" : "modified") as ChangedFile["status"], previousPath: f.previous_filename ?? null }));
      dependencyChanges = [];
      for (const f of files.filter((x) => x.filename.endsWith("package.json")).slice(0, 10)) {
        const before = pr.base?.sha ? await client.fileAt(p.installationId, repo, f.filename, pr.base.sha) : null;
        const after = f.status === "removed" || !pr.head?.sha ? null : await client.fileAt(p.installationId, repo, f.filename, pr.head.sha);
        dependencyChanges.push(...diffPackageJson(before, after, f.filename));
      }
    }

    const inbound = normalizeGithubEvent({ event: p.event, deliveryId: p.deliveryId, payload: p.payload, changedFiles, dependencyChanges });
    const { event } = await loop.evidence.ingest(p.tenantId, inbound);
    // Evaluate now, in this job: ingest also queued process_event, which
    // will find the event already processed and return its stored result.
    const result = await loop.triggers.process(p.tenantId, event.id);

    let commented = false;
    const type = eventTypeOf(p.event, p.payload);
    if (pr && client && p.advisory && type !== "pull_request.merged") {
      const actor: Actor = { tenantId: p.tenantId, type: "integration", userId: null, label: "github", scopes: ["read"], sessionId: `github:${repo}#${pr.number}` };
      const context = await loop.context.getContext(actor, {
        intent: `PR #${pr.number}: ${pr.title ?? ""}`.slice(0, 2000),
        repository: repo,
        resources: (changedFiles ?? []).map((f) => f.path).slice(0, 200),
      });
      const body = renderAdvisoryComment({ context, result, prUrl: pr.html_url });
      if (body) {
        await client.upsertComment(p.installationId, repo, pr.number, ADVISORY_MARKER, body);
        commented = true;
      }
    }
    return { eventId: event.id, findings: result.constraintFindings.length, conflicts: result.conflictIds.length, commented };
  };

  return { routes: [route], handlers: { github_event: handler } as Record<string, JobHandler> };
}
