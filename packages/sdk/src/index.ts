import type { ActionCheckInput, ContextRequestInput, DecisionDraftInput, EvidenceSubmissionInput, SourceEventInput } from "@decisionloop/core/contracts";
import type { DecisionLoopOperations } from "@decisionloop/core/operations";
import type { ResourceRef } from "@decisionloop/core/resources/resources";
import type { ApprovalStatus } from "@decisionloop/core/types/records";
import type { DecisionVerificationCheck } from "@decisionloop/core/types/domain";

/**
 * DecisionLoop TypeScript SDK.
 *
 *   const dl = new DecisionLoop({ apiKey: process.env.DECISIONLOOP_API_KEY });
 *   const context = await dl.context.get({ intent: "change database architecture", resources: ["services/api"] });
 *   const candidate = await dl.decisions.propose({ title: "…", chosenOption: { name: "…" }, assumptions: [ … ] });
 *
 * Types come from @decisionloop/core, the same contracts the server parses,
 * so client and server cannot drift. `client.operations` implements the
 * shared `DecisionLoopOperations` interface (used by the stdio MCP server).
 */

export interface DecisionLoopClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Identify an agent session so calls appear together in the Agent Run Inspector. */
  agent?: { name: string; sessionId: string; repository?: string | null } | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class DecisionLoopApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "DecisionLoopApiError";
  }
}

export class DecisionLoop {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private agent: DecisionLoopClientOptions["agent"];

  constructor(opts: DecisionLoopClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.DECISIONLOOP_API_KEY;
    this.baseUrl = (opts.baseUrl ?? process.env.DECISIONLOOP_URL ?? "http://127.0.0.1:4318").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.agent = opts.agent ?? null;
  }

  withAgent(agent: NonNullable<DecisionLoopClientOptions["agent"]>): DecisionLoop {
    return new DecisionLoop({ apiKey: this.apiKey, baseUrl: this.baseUrl, fetch: this.fetchImpl, timeoutMs: this.timeoutMs, agent });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.agent
            ? {
                "x-decisionloop-agent": this.agent.name,
                "x-decisionloop-session": this.agent.sessionId,
                ...(this.agent.repository ? { "x-decisionloop-repository": this.agent.repository } : {}),
              }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (res.status === 202 && (parsed as { code?: string })?.code === "approval_required") {
        const p = parsed as { error: string; approvalId: string };
        throw new DecisionLoopApiError(202, "approval_required", `${p.error} (approval ${p.approvalId})`, parsed);
      }
      if (!res.ok) {
        const p = (parsed ?? {}) as { error?: string; code?: string };
        throw new DecisionLoopApiError(res.status, p.code ?? "http_error", p.error ?? `HTTP ${res.status}`, parsed);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  readonly operations: DecisionLoopOperations = {
    whoami: () => this.request("GET", "/me"),
    getContext: (input) => this.request("POST", "/context", input),
    searchDecisions: (input) => this.request("POST", "/decisions/search", input),
    getDecision: (id) => this.request("GET", `/decisions/${encodeURIComponent(id)}`),
    explainDecision: (id) => this.request("GET", `/decisions/${encodeURIComponent(id)}/explain`),
    getConstraints: (input) => this.request("POST", "/constraints", input),
    checkAction: (input) => this.request("POST", "/actions/check", input),
    submitEvent: (input) => this.request("POST", "/events", input),
    listAtRisk: (limit = 20) => this.request("GET", `/at-risk?limit=${limit}`),
    getConflicts: (input) =>
      this.request(
        "GET",
        `/conflicts?${new URLSearchParams({
          ...(input.decisionId ? { decisionId: input.decisionId } : {}),
          includeResolved: String(Boolean(input.includeResolved)),
        })}`,
      ),
    proposeDecision: (draft) => this.request("POST", "/decisions", draft),
    createDecision: (draft) => this.request("POST", "/decisions?mode=commit", draft),
    commitDecision: (id, note) => this.request("POST", `/decisions/${id}/commit`, { note }),
    supersedeDecision: (id, supersededBy, note) => this.request("POST", `/decisions/${id}/supersede`, { supersededBy, note }),
    configureVerificationCheck: (id, check) => this.request("POST", `/decisions/${id}/verification-checks`, check),
    addEvidence: (input) => this.request("POST", "/evidence", input),
    getEvent: (id) => this.request("GET", `/events/${id}`),
    listEvents: (limit = 50) => this.request("GET", `/events?limit=${limit}`),
    getEventDetail: (id) => this.request("GET", `/events/${id}/detail`),
    recordOutcome: (input) => this.request("POST", `/decisions/${input.decisionId}/outcomes`, input),
    proposeAssumption: (input) => this.request("POST", `/decisions/${input.decisionId}/assumptions`, input),
    acceptConflict: (id, note) => this.request("POST", `/conflicts/${id}/accept`, { note }),
    dismissConflict: (id, note) => this.request("POST", `/conflicts/${id}/dismiss`, { note }),
    listApprovals: (status) => this.request("GET", `/approvals${status ? `?status=${status}` : ""}`),
    resolveApproval: (id, input) => this.request("POST", `/approvals/${id}`, input),
    blastRadius: (input) =>
      this.request(
        "GET",
        `/decisions/${input.decisionId ?? "_"}/blast-radius?${new URLSearchParams({
          ...(input.assumptionId ? { assumptionId: input.assumptionId } : {}),
          maxDepth: String(input.maxDepth ?? 4),
        })}`,
      ),
    attachSession: async (input) => {
      const r = await this.request<{ agentSessionId: string }>("POST", "/sessions", input);
      this.agent = { name: input.agent, sessionId: input.externalSessionId, repository: input.repository ?? null };
      return r;
    },
    endSession: (input) => this.request("POST", `/sessions/${input.agentSessionId}/end`, { outcome: input.outcome }),
    inspectSession: (id) => this.request("GET", `/sessions/${id}`),
    listSessions: () => this.request("GET", "/sessions"),
    getOverview: () => this.request("GET", "/overview"),
  };

  // ── Ergonomic namespaces ─────────────────────────────────────────────────
  readonly context = {
    get: (input: ContextRequestInput) => this.operations.getContext(input),
    constraints: (resources: Array<string | ResourceRef>, repository?: string | null) =>
      this.operations.getConstraints({ resources, repository }),
  };

  /** Dry run before an action with side effects. Advisory; writes no evidence. */
  readonly actions = {
    check: (input: ActionCheckInput) => this.operations.checkAction(input),
  };

  /** Events from a source system. Needs an integration key bound to that source. */
  readonly events = {
    send: (input: SourceEventInput) => this.operations.submitEvent(input),
  };

  readonly decisions = {
    propose: (draft: DecisionDraftInput) => this.operations.proposeDecision(draft),
    create: (draft: DecisionDraftInput) => this.operations.createDecision(draft),
    get: (idOrRef: string) => this.operations.getDecision(idOrRef),
    explain: (idOrRef: string) => this.operations.explainDecision(idOrRef),
    search: (query: string, limit = 10) => this.operations.searchDecisions({ query, limit }),
    atRisk: (limit?: number) => this.operations.listAtRisk(limit),
    commit: (id: string, note?: string) => this.operations.commitDecision(id, note),
    supersede: (id: string, by: string, note?: string) => this.operations.supersedeDecision(id, by, note),
    configureVerificationCheck: (id: string, check: DecisionVerificationCheck) => this.operations.configureVerificationCheck(id, check),
    recordOutcome: (decisionId: string, summary: string, sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE") =>
      this.operations.recordOutcome({ decisionId, summary, sentiment }),
    blastRadius: (input: { assumptionId?: string; decisionId?: string; maxDepth?: number }) => this.operations.blastRadius(input),
  };

  readonly evidence = {
    add: (input: EvidenceSubmissionInput) => this.operations.addEvidence(input),
    status: (eventId: string) => this.operations.getEvent(eventId),
  };

  readonly conflicts = {
    list: (decisionId?: string, includeResolved = false) => this.operations.getConflicts({ decisionId, includeResolved }),
    accept: (id: string, note?: string) => this.operations.acceptConflict(id, note),
    dismiss: (id: string, note?: string) => this.operations.dismissConflict(id, note),
  };

  readonly approvals = {
    list: (status?: ApprovalStatus) => this.operations.listApprovals(status),
    resolve: (id: string, action: "approve" | "reject" | "request_evidence" | "link" | "supersede_old", note?: string) =>
      this.operations.resolveApproval(id, { action, note }),
  };
}
