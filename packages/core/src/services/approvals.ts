import { normalizeKey, normalizeUnit } from "../assumptions/model";
import { approvalResolutionSchema, conflictResolutionSchema } from "../contracts";
import { InvalidRequestError, NotFoundError, requireHuman, requireScope } from "../errors";
import type { DecisionStore } from "../ports/store";
import type { Actor, ApprovalRequest, ApprovalStatus } from "../types/records";
import type { DecisionService } from "./decisions";
import type { ServiceDeps } from "./shared";

/**
 * Human decisions about memory (spec §25). The AI may recommend; only a
 * person moves organizational history. Every action is one transaction
 * that also writes the memory event and audit record explaining it.
 */
export class ConflictService {
  constructor(private readonly deps: ServiceDeps) {}

  /** The contradiction is real: the assumption is definitively invalid; the decision stays at risk. */
  async accept(actor: Actor, conflictId: string, input: unknown = {}) {
    requireHuman(actor, "accept a conflict");
    const { note } = conflictResolutionSchema.parse(input);
    return this.deps.store.transaction(async (tx) => {
      const conflict = await tx.getConflict(actor.tenantId, conflictId);
      if (!conflict) throw new NotFoundError("Conflict");
      if (conflict.resolution) throw new InvalidRequestError(`Conflict already ${conflict.resolution}.`);
      await tx.resolveConflict(actor.tenantId, conflictId, "ACCEPTED", { userId: actor.userId, label: actor.label, note });
      await tx.setAssumptionValidity(actor.tenantId, conflict.assumptionId, "INVALIDATED");
      await closeReviewApprovals(tx, actor, conflictId, "APPROVED", note);
      await this.suggestAlias(tx, actor, conflict);
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        entityType: "assumption",
        entityId: conflict.assumptionId,
        decisionId: conflict.decisionId,
        eventType: "CONFLICT_ACCEPTED",
        actorType: "USER",
        actorUserId: actor.userId,
        summary: note || "New evidence accepted; assumption confirmed invalid.",
        metadata: { conflictId },
      });
      await tx.recordAudit({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "conflict.accepted",
        entityType: "conflict",
        entityId: conflictId,
      });
      return tx.getDecision(actor.tenantId, conflict.decisionId);
    });
  }

  /**
   * The model had to be asked because the evidence and the assumption named one
   * thing two ways ("dispute_rate" vs "chargeback_rate_pct"). A person just
   * confirmed the model was right, so offer to make that an exact rule: the
   * next check is plain comparison — no model, no cost, same answer every time.
   * Nothing changes until a person approves the suggestion.
   */
  private async suggestAlias(tx: DecisionStore, actor: Actor, conflict: { id: string; decisionId: string; assumptionId: string }) {
    const evaluation = (await tx.listEvaluations(actor.tenantId, { decisionId: conflict.decisionId, limit: 50 })).find(
      (e) => e.assumptionId === conflict.assumptionId && e.method === "SEMANTIC" && e.fact,
    );
    const fact = evaluation?.fact;
    const assumption = await tx.getAssumption(actor.tenantId, conflict.assumptionId);
    if (!evaluation || !fact || !assumption?.predicate || assumption.valueType === "TEXT") return;

    const alias = normalizeKey(fact.predicate);
    const canonical = normalizeKey(assumption.predicate);
    if (!alias || !canonical || alias === canonical) return;
    if (fact.valueType !== assumption.valueType || fact.operator !== "=") return;
    const factUnit = normalizeUnit(fact.unit);
    const assumedUnit = normalizeUnit(assumption.unit);
    if (factUnit && assumedUnit && factUnit !== assumedUnit) return;
    const factSubject = normalizeKey(fact.subject);
    const assumedSubject = normalizeKey(assumption.subject);
    if (factSubject && assumedSubject && factSubject !== assumedSubject) return;

    const known = (await tx.listProfileOverrides(actor.tenantId)).some((o) => o.kind === "predicate_alias" && o.key === alias);
    if (known || this.deps.domains.evaluateOptions().predicateAliases?.[alias] === canonical) return;

    await tx.insertApproval({
      tenantId: actor.tenantId,
      kind: "PROFILE_SUGGESTION",
      decisionId: conflict.decisionId,
      conflictId: conflict.id,
      payload: { suggestion: "predicate_alias", alias, canonical, evaluationId: evaluation.id, subject: assumedSubject ?? factSubject },
      reason: `You confirmed a conflict that a model had to judge because two records name one thing differently: "${alias}" and "${canonical}". Treat them as the same from now on so this comparison is exact, free and repeatable.`,
      requestedByType: "system",
      requestedByLabel: "profile-learning",
      dedupeKey: `alias:${alias}:${canonical}`,
    });
  }

  /**
   * The flagged conflict does not apply (wrong subject, stale evidence,
   * false positive). The assumption returns to VALID and the decision to
   * ACTIVE — unless something else still holds it at risk. The conflict row
   * stays, marked DISMISSED with who and why: dismissals are the false-
   * positive data the evaluation suite learns from.
   */
  async dismiss(actor: Actor, conflictId: string, input: unknown = {}) {
    requireHuman(actor, "dismiss a conflict");
    const { note } = conflictResolutionSchema.parse(input);
    return this.deps.store.transaction(async (tx) => {
      const conflict = await tx.getConflict(actor.tenantId, conflictId);
      if (!conflict) throw new NotFoundError("Conflict");
      if (conflict.resolution) throw new InvalidRequestError(`Conflict already ${conflict.resolution}.`);
      await tx.resolveConflict(actor.tenantId, conflictId, "DISMISSED", { userId: actor.userId, label: actor.label, note });

      const others = await tx.listConflicts(actor.tenantId, { decisionId: conflict.decisionId, unresolvedOnly: true });
      const stillOnAssumption = others.some((c) => c.assumptionId === conflict.assumptionId);
      // A person may already have confirmed this assumption invalid via another
      // conflict; dismissing a later one must not undo that decision.
      const alreadyAccepted = (await tx.listConflicts(actor.tenantId, { decisionId: conflict.decisionId })).some(
        (c) => c.assumptionId === conflict.assumptionId && c.resolution === "ACCEPTED",
      );
      if (!stillOnAssumption && !alreadyAccepted) {
        await tx.setAssumptionValidity(actor.tenantId, conflict.assumptionId, "VALID");
      }
      const decision = await tx.getDecision(actor.tenantId, conflict.decisionId);
      const stillCompromised =
        others.length > 0 ||
        (decision?.assumptions ?? []).some((a) => a.validityStatus === "CHALLENGED" || a.validityStatus === "INVALIDATED");
      if (decision?.status === "AT_RISK" && !stillCompromised) {
        await tx.updateDecisionStatus(actor.tenantId, decision.id, "ACTIVE", { riskExplanation: null });
      }
      await closeReviewApprovals(tx, actor, conflictId, "REJECTED", note);
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        entityType: "conflict",
        entityId: conflictId,
        decisionId: conflict.decisionId,
        eventType: "CONFLICT_DISMISSED",
        actorType: "USER",
        actorUserId: actor.userId,
        summary: note || "Conflict dismissed; assumption restored.",
        metadata: { assumptionId: conflict.assumptionId, stillCompromised },
      });
      await tx.recordAudit({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "conflict.dismissed",
        entityType: "conflict",
        entityId: conflictId,
        metadata: { note: note ?? null },
      });
      return tx.getDecision(actor.tenantId, conflict.decisionId);
    });
  }

  /** The team reconsiders: the decision reopens with its history intact. */
  async reopen(actor: Actor, decisionId: string, note?: string | null) {
    requireHuman(actor, "reopen a decision");
    return this.deps.store.transaction(async (tx) => {
      const d = await tx.getDecision(actor.tenantId, decisionId);
      if (!d) throw new NotFoundError("Decision");
      const updated = await tx.updateDecisionStatus(actor.tenantId, decisionId, "REOPENED", { riskExplanation: d.riskExplanation });
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        entityType: "decision",
        entityId: decisionId,
        decisionId,
        eventType: "DECISION_REOPENED",
        actorType: "USER",
        actorUserId: actor.userId,
        summary: note || "Decision reopened for reconsideration.",
        metadata: { previousStatus: d.status },
      });
      return updated;
    });
  }
}

async function closeReviewApprovals(
  tx: DecisionStore,
  actor: Actor,
  conflictId: string,
  status: Exclude<ApprovalStatus, "PENDING">,
  note: string | null | undefined,
) {
  const pending = await tx.listApprovals(actor.tenantId, { status: "PENDING" });
  for (const a of pending.filter((p) => p.kind === "REVIEW_CONFLICT" && p.conflictId === conflictId)) {
    await tx.resolveApproval(actor.tenantId, a.id, status, { userId: actor.userId, label: actor.label, note });
  }
}

export class ApprovalService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly decisions: DecisionService,
    private readonly conflicts: ConflictService,
  ) {}

  async list(actor: Actor, opts: { status?: ApprovalStatus; limit?: number } = {}) {
    requireScope(actor, "read");
    // "Open" = still needs a person: pending, or waiting for more evidence.
    const approvals = opts.status
      ? await this.deps.store.listApprovals(actor.tenantId, { status: opts.status, limit: opts.limit })
      : [
          ...(await this.deps.store.listApprovals(actor.tenantId, { status: "PENDING", limit: opts.limit })),
          ...(await this.deps.store.listApprovals(actor.tenantId, { status: "NEEDS_EVIDENCE", limit: opts.limit })),
        ];
    const ids = Array.from(
      new Set(approvals.flatMap((a) => [a.decisionId, ...a.relatedDecisionIds]).filter((x): x is string => Boolean(x))),
    );
    const decisions = await this.deps.store.listDecisions(actor.tenantId, { ids });
    const byId = new Map(decisions.map((d) => [d.id, d]));
    return approvals.map((a) => ({
      approval: a,
      decision: a.decisionId ? (byId.get(a.decisionId) ?? null) : null,
      related: a.relatedDecisionIds.map((id) => byId.get(id)).filter(Boolean),
    }));
  }

  /**
   * APPROVE / REQUEST MORE EVIDENCE / REJECT / SUPERSEDE OLD DECISION /
   * LINK TO EXISTING DECISION (spec §25).
   */
  async resolve(actor: Actor, approvalId: string, input: unknown): Promise<ApprovalRequest> {
    requireHuman(actor, "resolve an approval");
    const req = approvalResolutionSchema.parse(input);
    const approval = await this.deps.store.getApproval(actor.tenantId, approvalId);
    if (!approval) throw new NotFoundError("Approval request");
    if (approval.status !== "PENDING" && approval.status !== "NEEDS_EVIDENCE") {
      throw new InvalidRequestError(`Approval already ${approval.status}.`);
    }
    const by = { userId: actor.userId, label: actor.label, note: req.note ?? null };
    const store = this.deps.store;

    if (req.action === "request_evidence") {
      return store.resolveApproval(actor.tenantId, approvalId, "NEEDS_EVIDENCE", by);
    }

    switch (approval.kind) {
      case "COMMIT_DECISION": {
        if (!approval.decisionId) throw new InvalidRequestError("Approval has no decision.");
        if (req.action === "approve" || req.action === "supersede_old") {
          await this.decisions.commit(actor, approval.decisionId, { approvalId, note: req.note });
          if (req.action === "supersede_old") {
            const target =
              (approval.payload?.supersedes as string | null | undefined) ??
              (approval.payload?.related as Array<{ decisionId: string; reintroducesRejectedAlternative: boolean }> | undefined)?.find(
                (r) => r.reintroducesRejectedAlternative,
              )?.decisionId ??
              approval.relatedDecisionIds[0];
            if (!target) throw new InvalidRequestError("No existing decision to supersede.");
            await this.decisions.supersede(actor, target, approval.decisionId, req.note);
            await store.recordAudit({
              tenantId: actor.tenantId,
              actorUserId: actor.userId,
              actorLabel: actor.label,
              action: "approval.superseded_old",
              entityType: "approval",
              entityId: approvalId,
              metadata: { superseded: target },
            });
          }
          return (await store.getApproval(actor.tenantId, approvalId))!;
        }
        if (req.action === "reject") {
          await this.decisions.reject(actor, approval.decisionId, req.note ?? null);
          return store.resolveApproval(actor.tenantId, approvalId, "REJECTED", by);
        }
        if (req.action === "link") {
          const target = req.linkDecisionId ?? approval.relatedDecisionIds[0];
          if (!target) throw new InvalidRequestError("link needs linkDecisionId.");
          await this.decisions.reject(actor, approval.decisionId, `Duplicate of existing decision ${target}.`);
          await store.insertDependencies(actor.tenantId, target, [
            { targetType: "DECISION", targetId: approval.decisionId, relationship: "DUPLICATED_BY", importance: 0.2 },
          ]);
          return store.resolveApproval(actor.tenantId, approvalId, "LINKED", { ...by, note: req.note ?? `Linked to ${target}` });
        }
        break;
      }
      case "REVIEW_CONFLICT": {
        if (!approval.conflictId) throw new InvalidRequestError("Approval has no conflict.");
        if (req.action === "approve") await this.conflicts.accept(actor, approval.conflictId, { note: req.note });
        else if (req.action === "reject") await this.conflicts.dismiss(actor, approval.conflictId, { note: req.note });
        else throw new InvalidRequestError(`${req.action} does not apply to a conflict review.`);
        return (await store.getApproval(actor.tenantId, approvalId))!;
      }
      case "ADD_ASSUMPTION": {
        if (req.action === "approve") {
          await this.decisions.addApprovedAssumption(actor, approval.decisionId!, approval.payload?.assumption);
          return store.resolveApproval(actor.tenantId, approvalId, "APPROVED", by);
        }
        if (req.action === "reject") return store.resolveApproval(actor.tenantId, approvalId, "REJECTED", by);
        break;
      }
      case "PROFILE_SUGGESTION": {
        if (req.action === "reject") return store.resolveApproval(actor.tenantId, approvalId, "REJECTED", by);
        if (req.action !== "approve") break;
        const suggestion = approval.payload as { suggestion?: string; alias?: string; canonical?: string } | null;
        if (suggestion?.suggestion !== "predicate_alias" || !suggestion.alias || !suggestion.canonical) {
          throw new InvalidRequestError("This suggestion has no alias to apply.");
        }
        const { alias, canonical } = suggestion;
        return store.transaction(async (tx) => {
          await tx.upsertProfileOverride({
            tenantId: actor.tenantId,
            kind: "predicate_alias",
            key: alias,
            value: { canonical },
            approvalId,
            createdBy: actor.label,
          });
          await tx.recordAudit({
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            actorLabel: actor.label,
            action: "profile.alias_approved",
            entityType: "approval",
            entityId: approvalId,
            metadata: { alias, canonical },
          });
          return tx.resolveApproval(actor.tenantId, approvalId, "APPROVED", by);
        });
      }
      case "SUPERSEDE_DECISION":
        break;
    }
    throw new InvalidRequestError(`${req.action} does not apply to a ${approval.kind} request.`);
  }
}
