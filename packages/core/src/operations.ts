import type { ContextRequestInput, DecisionDraftInput, EvidenceSubmissionInput } from "./contracts";
import { ApprovalRequiredError, NotFoundError, requireScope } from "./errors";
import type { StoredEvent } from "./events/event";
import type { ApprovalService } from "./services/approvals";
import type { ConstraintMatch, ContextResponse } from "./services/context";
import type { DecisionService, RelatedDecision } from "./services/decisions";
import type { BlastRadius } from "./services/graph";
import type { DecisionLoop } from "./services/index";
import type { ResourceRef } from "./resources/resources";
import type { ConflictEvent, Decision, DecisionStatus, DecisionWithDetails } from "./types/domain";
import type { Actor, AgentSession, ApprovalRequest, ApprovalStatus } from "./types/records";

/**
 * The operations every integration surface exposes. Implemented twice with
 * identical semantics:
 *   - in process, bound to an authenticated actor (`bindOperations`), used
 *     by the HTTP API and the server-hosted MCP endpoint;
 *   - over HTTP by the SDK, used by the stdio MCP server, the CLI and
 *     agent hooks — which therefore never hold database credentials.
 * MCP tools are written against this interface once.
 */
export interface DecisionLoopOperations {
  whoami(): Promise<{ workspaceId: string; actor: string; type: Actor["type"]; scopes: string[]; agentSessionId: string | null }>;
  getContext(input: ContextRequestInput): Promise<ContextResponse>;
  searchDecisions(input: { query: string; statuses?: DecisionStatus[]; limit?: number }): Promise<Array<{ decision: DecisionWithDetails; score: number }>>;
  getDecision(idOrRef: string): Promise<Awaited<ReturnType<DecisionService["history"]>>>;
  explainDecision(idOrRef: string): Promise<Awaited<ReturnType<DecisionService["explain"]>>>;
  getConstraints(input: { resources: Array<string | ResourceRef>; repository?: string | null }): Promise<ConstraintMatch[]>;
  listAtRisk(limit?: number): Promise<Awaited<ReturnType<DecisionService["listAtRisk"]>>>;
  getConflicts(input: { decisionId?: string | null; includeResolved?: boolean }): Promise<ConflictEvent[]>;
  proposeDecision(draft: DecisionDraftInput): Promise<{ decision: DecisionWithDetails; approval: ApprovalRequest; related: RelatedDecision[] }>;
  createDecision(draft: DecisionDraftInput): Promise<DecisionWithDetails>;
  commitDecision(id: string, note?: string | null): Promise<DecisionWithDetails>;
  supersedeDecision(id: string, supersededBy: string, note?: string | null): Promise<Decision>;
  addEvidence(input: EvidenceSubmissionInput): Promise<{ eventId: string; created: boolean; jobId: string | null; status: string }>;
  getEvent(id: string): Promise<StoredEvent>;
  recordOutcome(input: { decisionId: string; summary: string; sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" }): Promise<{ id: string }>;
  proposeAssumption(input: { decisionId: string; assumption: unknown; reason?: string | null }): Promise<{ approvalId: string | null; assumptionId: string | null }>;
  acceptConflict(id: string, note?: string | null): Promise<DecisionWithDetails | null>;
  dismissConflict(id: string, note?: string | null): Promise<DecisionWithDetails | null>;
  listApprovals(status?: ApprovalStatus): Promise<Awaited<ReturnType<ApprovalService["list"]>>>;
  resolveApproval(id: string, input: { action: string; note?: string | null; linkDecisionId?: string | null }): Promise<ApprovalRequest>;
  blastRadius(input: { assumptionId?: string | null; decisionId?: string | null; maxDepth?: number }): Promise<BlastRadius>;
  attachSession(input: { agent: string; externalSessionId: string; repository?: string | null; intent?: string | null }): Promise<{ agentSessionId: string }>;
  endSession(input: { agentSessionId: string; outcome?: string | null }): Promise<void>;
  inspectSession(agentSessionId: string): Promise<unknown>;
  listSessions(): Promise<AgentSession[]>;
}

export function bindOperations(loop: DecisionLoop, initialActor: Actor): DecisionLoopOperations {
  let actor = initialActor;
  return {
    async whoami() {
      return {
        workspaceId: actor.tenantId,
        actor: actor.label,
        type: actor.type,
        scopes: actor.scopes,
        agentSessionId: actor.agentSessionId ?? null,
      };
    },
    async getContext(input) {
      // An agent can identify its session on the context call itself (hooks
      // and MCP clients that cannot set headers); later calls inherit it.
      if (input.agent && input.agentSessionId && !actor.agentSessionId) {
        actor = await loop.sessions.attach(actor, {
          agent: input.agent,
          externalSessionId: input.agentSessionId,
          repository: input.repository ?? null,
          intent: input.intent,
        });
      }
      return loop.context.getContext(actor, input);
    },
    searchDecisions: (input) => loop.decisions.search(actor, input),
    getDecision: (id) => loop.decisions.history(actor, id),
    explainDecision: (id) => loop.decisions.explain(actor, id),
    getConstraints: (input) => loop.context.getConstraints(actor, input),
    listAtRisk: (limit) => loop.decisions.listAtRisk(actor, limit),
    async getConflicts(input) {
      requireScope(actor, "read");
      return loop.store.listConflicts(actor.tenantId, {
        decisionId: input.decisionId ?? undefined,
        unresolvedOnly: !input.includeResolved,
      });
    },
    proposeDecision: (draft) => loop.decisions.propose(actor, draft),
    createDecision: (draft) => loop.decisions.create(actor, draft),
    commitDecision: (id, note) => loop.decisions.commit(actor, id, { note }),
    supersedeDecision: (id, by, note) => loop.decisions.supersede(actor, id, by, note),
    async addEvidence(input) {
      const r = await loop.evidence.submit(actor, input);
      return { eventId: r.event.id, created: r.created, jobId: r.jobId, status: r.event.status };
    },
    async getEvent(id) {
      requireScope(actor, "read");
      const e = await loop.store.getEvent(actor.tenantId, id);
      if (!e) throw new NotFoundError("Event");
      return e;
    },
    recordOutcome: (input) => loop.decisions.recordOutcome(actor, input),
    async proposeAssumption(input) {
      const r = await loop.decisions.proposeAssumption(actor, input);
      return { approvalId: r.approval?.id ?? null, assumptionId: r.assumptionId ?? null };
    },
    acceptConflict: (id, note) => loop.conflicts.accept(actor, id, { note }),
    dismissConflict: (id, note) => loop.conflicts.dismiss(actor, id, { note }),
    listApprovals: (status) => loop.approvals.list(actor, { status }),
    resolveApproval: (id, input) => loop.approvals.resolve(actor, id, input),
    blastRadius: (input) => loop.graph.blastRadius(actor, input),
    async attachSession(input) {
      actor = await loop.sessions.attach(actor, input);
      return { agentSessionId: actor.agentSessionId! };
    },
    endSession: (input) => loop.sessions.end(actor, input.agentSessionId, input.outcome ?? null),
    inspectSession: (id) => loop.sessions.inspect(actor, id),
    listSessions: () => loop.sessions.list(actor),
  };
}

export { ApprovalRequiredError };
