import { InvalidRequestError, NotFoundError, requireScope } from "../errors";
import type { DecisionStatus } from "../types/domain";
import type { Actor, DecisionDependency } from "../types/records";
import type { ServiceDeps } from "./shared";

/**
 * Decision Blast Radius (spec §21–§22): if this assumption (or decision)
 * changes, what else might be affected?
 *
 * Built only from recorded `decision_dependencies` rows. Nothing is
 * inferred for visual effect: a decision appears downstream only because a
 * person or agent recorded that it depends on something upstream.
 * SUPERSEDES / DUPLICATED_BY links are history, not dependency, and are
 * not traversed.
 */

const HISTORY_RELATIONSHIPS = new Set(["SUPERSEDES", "DUPLICATED_BY"]);

export interface BlastRadiusNode {
  decisionId: string;
  title: string;
  externalRef: string | null;
  status: DecisionStatus;
  depth: number;
}

export interface BlastRadius {
  root: { assumptionId: string | null; decisionId: string; label: string };
  nodes: BlastRadiusNode[];
  edges: Array<{ from: string; to: string; relationship: string; importance: number; viaAssumption: string | null }>;
  truncated: boolean;
}

export class GraphService {
  constructor(private readonly deps: ServiceDeps) {}

  async blastRadius(
    actor: Actor,
    input: { assumptionId?: string | null; decisionId?: string | null; maxDepth?: number },
  ): Promise<BlastRadius> {
    requireScope(actor, "read");
    const store = this.deps.store;
    const maxDepth = Math.min(input.maxDepth ?? 4, 8);

    let rootDecisionId: string;
    let label: string;
    if (input.assumptionId) {
      const a = await store.getAssumption(actor.tenantId, input.assumptionId);
      if (!a) throw new NotFoundError("Assumption");
      rootDecisionId = a.decisionId;
      label = a.statement;
    } else if (input.decisionId) {
      const d = await store.getDecision(actor.tenantId, input.decisionId);
      if (!d) throw new NotFoundError("Decision");
      rootDecisionId = d.id;
      label = d.title;
    } else {
      throw new InvalidRequestError("Provide assumptionId or decisionId.");
    }

    const root = await store.getDecision(actor.tenantId, rootDecisionId);
    const nodes = new Map<string, BlastRadiusNode>([
      [root!.id, { decisionId: root!.id, title: root!.title, externalRef: root!.externalRef, status: root!.status, depth: 0 }],
    ]);
    const edges: BlastRadius["edges"] = [];
    // The first hop starts from the assumption itself when one was given:
    // decisions that depend on *that* assumption, plus decisions that depend
    // on its parent decision as a whole.
    let frontier: Array<{ decisionId: string; targetIds: string[] }> = [
      { decisionId: root!.id, targetIds: input.assumptionId ? [input.assumptionId, root!.id] : [root!.id, ...root!.assumptions.map((a) => a.id)] },
    ];
    let truncated = false;

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const targetToDecision = new Map<string, string>();
      for (const f of frontier) for (const t of f.targetIds) targetToDecision.set(t, f.decisionId);
      const deps: DecisionDependency[] = await store.listDependencies(actor.tenantId, { targetIds: Array.from(targetToDecision.keys()) });
      const next: string[] = [];
      for (const dep of deps) {
        if (HISTORY_RELATIONSHIPS.has(dep.relationship) || !dep.targetId) continue;
        const upstream = targetToDecision.get(dep.targetId)!;
        edges.push({
          from: dep.decisionId,
          to: upstream,
          relationship: dep.relationship,
          importance: dep.importance,
          viaAssumption: dep.targetType === "ASSUMPTION" ? dep.targetId : null,
        });
        if (!nodes.has(dep.decisionId)) next.push(dep.decisionId);
      }
      if (next.length === 0) break;
      const loaded = await store.listDecisions(actor.tenantId, { ids: Array.from(new Set(next)) });
      for (const d of loaded) {
        nodes.set(d.id, { decisionId: d.id, title: d.title, externalRef: d.externalRef, status: d.status, depth });
      }
      frontier = loaded.map((d) => ({ decisionId: d.id, targetIds: [d.id, ...d.assumptions.map((a) => a.id)] }));
      if (depth === maxDepth && frontier.length > 0) truncated = true;
    }

    return {
      root: { assumptionId: input.assumptionId ?? null, decisionId: root!.id, label },
      nodes: Array.from(nodes.values()).sort((a, b) => a.depth - b.depth),
      edges,
      truncated,
    };
  }
}

export class SessionService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Binds an actor to an external agent session (Claude Code, Codex, Copilot …). */
  async attach(actor: Actor, input: { agent: string; externalSessionId: string; repository?: string | null; intent?: string | null }): Promise<Actor> {
    const session = await this.deps.store.upsertAgentSession({
      tenantId: actor.tenantId,
      agent: input.agent,
      externalSessionId: input.externalSessionId,
      repository: input.repository ?? null,
      intent: input.intent ?? null,
      apiKeyId: actor.apiKeyId ?? null,
    });
    return { ...actor, agentSessionId: session.id, sessionId: `${input.agent}:${input.externalSessionId}` };
  }

  async end(actor: Actor, agentSessionId: string, outcome: string | null) {
    await this.deps.store.endAgentSession(actor.tenantId, agentSessionId, outcome);
  }

  async list(actor: Actor, limit = 50) {
    requireScope(actor, "read");
    return this.deps.store.listAgentSessions(actor.tenantId, { limit });
  }

  /**
   * "What did the agent know when it made this change?" (spec §24): every
   * context request with the decisions and constraints it returned, every
   * proposal and approval, every evaluation its evidence triggered.
   */
  async inspect(actor: Actor, agentSessionId: string) {
    requireScope(actor, "read");
    const store = this.deps.store;
    const session = await store.getAgentSession(actor.tenantId, agentSessionId);
    if (!session) throw new NotFoundError("Agent session");
    const runs = await store.listRuns(actor.tenantId, { agentSessionId });
    const approvals = (await store.listApprovals(actor.tenantId, { limit: 500 })).filter((a) => a.agentSessionId === agentSessionId);
    const proposalIds = approvals.map((a) => a.decisionId).filter((x): x is string => Boolean(x));
    const contextDecisionIds = Array.from(
      new Set(runs.flatMap((r) => ((r.details?.decisionIds as string[] | undefined) ?? []))),
    );
    const decisions = await store.listDecisions(actor.tenantId, { ids: Array.from(new Set([...proposalIds, ...contextDecisionIds])) });
    const byId = new Map(decisions.map((d) => [d.id, d]));
    return {
      session,
      contextRequests: runs
        .filter((r) => r.intent === "CONTEXT_REQUEST")
        .map((r) => ({
          runId: r.id,
          at: r.startedAt,
          intent: r.request,
          resources: (r.details?.resources as unknown[]) ?? [],
          decisions: ((r.details?.decisionIds as string[]) ?? []).map((id) => {
            const snapshot = (r.details?.provided as Array<{ id: string; title: string; status: string; externalRef: string | null }> | undefined)?.find(
              (p) => p.id === id,
            );
            const current = byId.get(id);
            return {
              id,
              title: snapshot?.title ?? current?.title ?? "(unavailable)",
              // Status when the context was served; current status alongside.
              status: snapshot?.status ?? current?.status ?? null,
              statusNow: current?.status ?? null,
              externalRef: snapshot?.externalRef ?? current?.externalRef ?? null,
            };
          }),
          constraintCount: (r.details?.constraintCount as number) ?? 0,
          tokenEstimate: (r.details?.tokenEstimate as number) ?? null,
          memoryTraceId: (r.details?.memoryTraceId as string) ?? null,
          memoriesRetrieved: r.memoriesRetrieved,
        })),
      evidenceRuns: runs.filter((r) => r.intent === "TRIGGER_EVALUATION"),
      proposals: approvals.map((a) => ({ approval: a, decision: a.decisionId ? (byId.get(a.decisionId) ?? null) : null })),
      runs,
    };
  }
}
