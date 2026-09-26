import type { Actor, Scope } from "./types/records";

/** Typed failures every surface maps to its own error format (HTTP status, MCP error, CLI exit code). */

export class DecisionLoopError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "invalid" | "conflict" | "approval_required" | "unavailable",
  ) {
    super(message);
    this.name = "DecisionLoopError";
  }
}

export class NotFoundError extends DecisionLoopError {
  constructor(what: string) {
    super(`${what} not found in this workspace.`, "not_found");
  }
}

export class ForbiddenError extends DecisionLoopError {
  constructor(message: string) {
    super(message, "forbidden");
  }
}

export class InvalidRequestError extends DecisionLoopError {
  constructor(message: string) {
    super(message, "invalid");
  }
}

export class ApprovalRequiredError extends DecisionLoopError {
  constructor(
    message: string,
    readonly approvalId: string,
  ) {
    super(message, "approval_required");
  }
}

const SCOPE_RANK: Record<Scope, number> = { read: 0, propose: 1, write: 2, admin: 3 };

export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.scopes.some((s) => SCOPE_RANK[s] >= SCOPE_RANK[scope]);
}

export function requireScope(actor: Actor, scope: Scope): void {
  if (!hasScope(actor, scope)) {
    throw new ForbiddenError(`This credential lacks the "${scope}" scope.`);
  }
}

/**
 * Only a human may make organizational memory authoritative (approve,
 * commit, accept or dismiss conflicts, supersede). An agent key with every
 * scope still cannot — spec §8: "Do not allow an arbitrary external agent
 * to silently rewrite authoritative organizational history."
 */
export function requireHuman(actor: Actor, action: string): void {
  requireScope(actor, "write");
  if (actor.type !== "user") {
    throw new ForbiddenError(`Only a person can ${action}; ${actor.type} credentials may propose, not decide.`);
  }
}
