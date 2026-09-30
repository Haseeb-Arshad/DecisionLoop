"use client";
import { PageHeader } from "@/components/Workspace";

import Link from "next/link";
import { useState } from "react";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import type { DecisionWithDetails } from "@/lib/types";
import { timeAgo, useV1, useV1Mutation, v1 } from "@/lib/v1";

interface ApprovalRow {
  approval: {
    id: string;
    kind:
      | "COMMIT_DECISION"
      | "ADD_ASSUMPTION"
      | "REVIEW_CONFLICT"
      | "SUPERSEDE_DECISION";
    status: string;
    reason: string;
    requestedByType: string;
    requestedByLabel: string | null;
    relatedDecisionIds: string[];
    conflictId: string | null;
    payload: {
      related?: Array<{
        decisionId: string;
        reintroducesRejectedAlternative: boolean;
        reasons: string[];
      }>;
    } | null;
    createdAt: string;
  };
  decision: DecisionWithDetails | null;
  related: DecisionWithDetails[];
}

const KIND_LABEL: Record<ApprovalRow["approval"]["kind"], string> = {
  COMMIT_DECISION: "Proposed decision",
  ADD_ASSUMPTION: "Proposed assumption",
  REVIEW_CONFLICT: "Evidence review",
  SUPERSEDE_DECISION: "Supersession",
};

type Action =
  "approve" | "reject" | "request_evidence" | "link" | "supersede_old";

/**
 * The approval queue (spec §25). Agents and integrations propose; a person
 * decides what becomes authoritative organizational memory.
 */
export default function ApprovalsPage() {
  const { data, isLoading, error } = useV1<ApprovalRow[]>(
    ["approvals"],
    "/approvals",
  );
  const rows = data ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Workspace operations"
        title="Approvals"
        description={
          <>
            Candidate decisions from agents, and evidence that would invalidate
            an important assumption. Nothing here is authoritative until a
            person approves it; rejected proposals stay on record.
          </>
        }
      />
      {error ? (
        <div className="card px-6 py-6 text-sm text-risk-600">
          {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm text-ink-200">
            Nothing is waiting for a decision.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Agents propose decisions with decisionloop_propose_decision.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <ApprovalCard key={row.approval.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ row }: { row: ApprovalRow }) {
  const { approval, decision, related } = row;
  const [note, setNote] = useState("");
  const resolve = useV1Mutation((action: Action) =>
    v1(`/approvals/${approval.id}`, { body: { action, note: note || null } }),
  );
  const flagged = new Set(
    (approval.payload?.related ?? [])
      .filter((r) => r.reintroducesRejectedAlternative)
      .map((r) => r.decisionId),
  );
  const chosen = decision?.options.find((o) => o.isChosen);

  return (
    <div className={`card p-5 ${flagged.size ? "border-amber-500/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-500">
            {KIND_LABEL[approval.kind]} ·{" "}
            {approval.requestedByLabel ?? approval.requestedByType} ·{" "}
            {timeAgo(approval.createdAt)}
            {approval.status === "NEEDS_EVIDENCE" && (
              <span className="ml-2 text-amber-700">waiting for evidence</span>
            )}
          </p>
          {decision && (
            <h2 className="mt-1 font-medium text-ink-100">
              <Link
                href={`/decisions/${decision.id}`}
                className="hover:underline"
              >
                {decision.title}
              </Link>
            </h2>
          )}
        </div>
        {decision && <DecisionStatusBadge status={decision.status} />}
      </div>

      <p
        className={`mt-3 text-sm ${flagged.size ? "text-amber-700" : "text-ink-300"}`}
      >
        {approval.reason}
      </p>

      {decision && approval.kind === "COMMIT_DECISION" && (
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="label">Chosen</p>
            <p className="text-ink-200">{chosen?.name ?? "—"}</p>
            {decision.reasoning && (
              <p className="mt-1 text-ink-400">{decision.reasoning}</p>
            )}
            {decision.options
              .filter((o) => !o.isChosen)
              .map((o) => (
                <p key={o.id} className="mt-1 text-ink-400">
                  Rejected {o.name}
                  {o.rejectionReason ? ` — ${o.rejectionReason}` : ""}
                </p>
              ))}
          </div>
          <div>
            <p className="label">Assumptions</p>
            {decision.assumptions.length === 0 ? (
              <p className="text-ink-500">
                None recorded — consider requesting them.
              </p>
            ) : (
              decision.assumptions.map((a) => (
                <p key={a.id} className="text-ink-300">
                  {a.statement}
                  {a.normalizedStatement && (
                    <span className="ml-1 font-mono text-xs text-ink-500">
                      ({a.normalizedStatement})
                    </span>
                  )}
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-4 space-y-1 text-sm">
          <p className="label">Existing decisions it bears on</p>
          {related.map((d) => (
            <p
              key={d.id}
              className={flagged.has(d.id) ? "text-amber-700" : "text-ink-300"}
            >
              <Link href={`/decisions/${d.id}`} className="hover:underline">
                {d.title}
              </Link>{" "}
              <span className="text-ink-500">[{d.status}]</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-3">
        <input
          className="input"
          placeholder="Note for the record (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate("approve")}
          >
            {approval.kind === "REVIEW_CONFLICT"
              ? "Accept evidence"
              : "Approve"}
          </button>
          {approval.kind === "COMMIT_DECISION" && related.length > 0 && (
            <button
              className="btn-secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("supersede_old")}
            >
              Approve &amp; supersede old decision
            </button>
          )}
          {approval.kind !== "REVIEW_CONFLICT" && (
            <button
              className="btn-secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("request_evidence")}
            >
              Request more evidence
            </button>
          )}
          {approval.kind === "COMMIT_DECISION" && related.length > 0 && (
            <button
              className="btn-secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("link")}
            >
              Duplicate — link to existing
            </button>
          )}
          <button
            className="btn-secondary"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate("reject")}
          >
            {approval.kind === "REVIEW_CONFLICT"
              ? "Dismiss (false positive)"
              : "Reject"}
          </button>
        </div>
        {resolve.error && (
          <p className="text-sm text-risk-600">
            {(resolve.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
