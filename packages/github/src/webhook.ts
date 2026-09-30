import crypto from "node:crypto";
import type { InboundEventInput } from "@decisionloop/core/events/event";
import type { ChangedFile, DependencyChange } from "@decisionloop/core/domain-packs/engineering";

/**
 * GitHub webhook verification and normalization (docs/v2 §11).
 *
 * Verification happens on the raw body, before JSON parsing, with a
 * constant-time comparison. An unsigned or mis-signed delivery never
 * reaches the engine.
 */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export interface GithubPayload {
  action?: string;
  repository?: { full_name?: string; html_url?: string };
  installation?: { id?: number };
  sender?: { login?: string; type?: string };
  pull_request?: {
    number: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    merged?: boolean;
    merged_at?: string | null;
    updated_at?: string;
    head?: { sha?: string; ref?: string };
    base?: { sha?: string; ref?: string };
    user?: { login?: string; type?: string };
  };
  workflow_run?: { id?: number; run_attempt?: number; name?: string; conclusion?: string | null; html_url?: string; head_sha?: string; updated_at?: string };
  release?: { tag_name?: string; html_url?: string; body?: string | null; published_at?: string };
  issue?: { number: number; title?: string; body?: string | null; html_url?: string; updated_at?: string };
  comment?: { body?: string; html_url?: string; updated_at?: string };
  head_commit?: { id?: string; message?: string; timestamp?: string; url?: string };
  commits?: Array<{ added?: string[]; removed?: string[]; modified?: string[] }>;
}

export function eventTypeOf(event: string, payload: GithubPayload): string {
  if (event === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) return "pull_request.merged";
  return payload.action ? `${event}.${payload.action}` : event;
}

/** Events worth evaluating. Everything else is acknowledged and ignored. */
export const RELEVANT_EVENT_TYPES = new Set([
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.reopened",
  "pull_request.merged",
  "push",
  "release.published",
  "workflow_run.completed",
  "issues.opened",
  "issues.closed",
]);

/**
 * Canonical event from a GitHub delivery plus enrichment the worker fetched
 * (changed files, dependency diffs). PR titles, bodies and comments go in
 * `text`: untrusted evidence, never instructions.
 */
export function normalizeGithubEvent(input: {
  event: string;
  deliveryId: string;
  payload: GithubPayload;
  changedFiles?: ChangedFile[];
  dependencyChanges?: DependencyChange[];
}): InboundEventInput {
  const { payload } = input;
  const type = eventTypeOf(input.event, payload);
  const repository = payload.repository?.full_name?.toLowerCase() ?? null;
  const pr = payload.pull_request;
  const url =
    pr?.html_url ?? payload.workflow_run?.html_url ?? payload.release?.html_url ?? payload.issue?.html_url ?? payload.head_commit?.url ?? payload.repository?.html_url ?? null;
  const occurredAt =
    pr?.merged_at ?? pr?.updated_at ?? payload.workflow_run?.updated_at ?? payload.release?.published_at ?? payload.issue?.updated_at ?? payload.head_commit?.timestamp ?? new Date().toISOString();

  const text = pr
    ? `PR #${pr.number}: ${pr.title ?? ""}\n\n${pr.body ?? ""}`
    : payload.issue
      ? `Issue #${payload.issue.number}: ${payload.issue.title ?? ""}\n\n${payload.issue.body ?? ""}`
      : payload.release
        ? `Release ${payload.release.tag_name ?? ""}\n\n${payload.release.body ?? ""}`
        : (payload.head_commit?.message ?? null);

  const pushFiles: ChangedFile[] =
    input.event === "push"
      ? (payload.commits ?? []).flatMap((c) => [
          ...(c.added ?? []).map((p) => ({ path: p, status: "added" as const })),
          ...(c.removed ?? []).map((p) => ({ path: p, status: "removed" as const })),
          ...(c.modified ?? []).map((p) => ({ path: p, status: "modified" as const })),
        ])
      : [];

  return {
    source: "github",
    externalId: input.deliveryId,
    type,
    occurredAt: new Date(occurredAt).toISOString(),
    actor: { type: "integration", id: payload.sender?.login ?? null, label: `github:${payload.sender?.login ?? "unknown"}` },
    evidenceKind: pr || input.event === "push" ? "CODE_DIFF" : input.event === "workflow_run" ? "TEST_RESULT" : "OBSERVATION",
    text: text ? text.slice(0, 20_000) : null,
    subject: repository ? `repository:${repository}` : null,
    payload: {
      repository,
      number: pr?.number ?? payload.issue?.number ?? null,
      headSha: pr?.head?.sha ?? payload.head_commit?.id ?? payload.workflow_run?.head_sha ?? null,
      changedFiles: input.changedFiles ?? pushFiles,
      dependencyChanges: input.dependencyChanges ?? [],
      ...(payload.workflow_run?.conclusion
        ? {
            ci: {
              workflow: payload.workflow_run.name ?? "workflow",
              conclusion: payload.workflow_run.conclusion,
              runId: payload.workflow_run.id === undefined ? null : String(payload.workflow_run.id),
              runAttempt: payload.workflow_run.run_attempt ?? 1,
              headSha: payload.workflow_run.head_sha ?? null,
              detailsUrl: payload.workflow_run.html_url ?? null,
            },
          }
        : {}),
    },
    provenance: { receivedVia: "github-webhook", signatureVerified: true, url },
  };
}
