import { DomainRegistry } from "../domain-packs/pack";
import { engineeringPack } from "../domain-packs/engineering";
import { DEFAULT_POLICIES } from "../policy/policy";
import type { EmbeddingProvider, ReasoningProvider } from "../ports/providers";
import type { DecisionStore } from "../ports/store";
import { ApprovalService, ConflictService } from "./approvals";
import { ContextService } from "./context";
import { DecisionService } from "./decisions";
import { GraphService, SessionService } from "./graph";
import type { Logger, ServiceDeps } from "./shared";
import { EvidenceService, TriggerEngine } from "./triggers";
import { PermanentJobError, Worker, type JobHandler, type WorkerOptions } from "./worker";

export * from "./approvals";
export * from "./context";
export * from "./decisions";
export * from "./graph";
export * from "./shared";
export * from "./triggers";
export * from "./worker";

/**
 * One DecisionLoop instance: every surface (HTTP API, MCP server, CLI,
 * worker, web app) builds this from its own store and providers and calls
 * the same services — the business logic exists once.
 */
export function createDecisionLoop(input: {
  store: DecisionStore;
  embeddings: EmbeddingProvider;
  reasoning: ReasoningProvider;
  domains?: DomainRegistry;
  logger?: Logger;
}) {
  const deps: ServiceDeps = {
    store: input.store,
    embeddings: input.embeddings,
    reasoning: input.reasoning,
    domains: input.domains ?? new DomainRegistry([engineeringPack]),
    defaultPolicies: DEFAULT_POLICIES,
    logger: input.logger,
  };
  const decisions = new DecisionService(deps);
  const conflicts = new ConflictService(deps);
  const approvals = new ApprovalService(deps, decisions, conflicts);
  const triggers = new TriggerEngine(deps);
  const loop = {
    deps,
    store: input.store,
    decisions,
    conflicts,
    approvals,
    evidence: new EvidenceService(deps),
    triggers,
    context: new ContextService(deps),
    graph: new GraphService(deps),
    sessions: new SessionService(deps),
    /** Core job handlers; integrations register more (e.g. GitHub comments). */
    jobHandlers(): Record<string, JobHandler> {
      return {
        process_event: async (job) => {
          const { tenantId, eventId } = job.payload as { tenantId?: string; eventId?: string };
          if (!tenantId || !eventId) throw new PermanentJobError("process_event needs tenantId and eventId.");
          const result = await triggers.process(tenantId, eventId);
          return {
            conflicts: result.conflictIds.length,
            decisionsAtRisk: result.decisionsAtRisk,
            findings: result.constraintFindings.length,
          };
        },
        index_decision: async (job) => {
          const { tenantId, decisionId } = job.payload as { tenantId?: string; decisionId?: string };
          if (!tenantId || !decisionId) throw new PermanentJobError("index_decision needs tenantId and decisionId.");
          return { chunks: await decisions.indexMemory(tenantId, decisionId) };
        },
      };
    },
    createWorker(opts: WorkerOptions, extraHandlers: Record<string, JobHandler> = {}) {
      return new Worker(input.store, { ...loop.jobHandlers(), ...extraHandlers }, { logger: input.logger, ...opts });
    },
  };
  return loop;
}

export type DecisionLoop = ReturnType<typeof createDecisionLoop>;
