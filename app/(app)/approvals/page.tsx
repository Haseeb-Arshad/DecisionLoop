"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import type { DecisionWithDetails } from "@/lib/types";
import { useV1, useV1Mutation, v1 } from "@/lib/v1";

type Kind = "COMMIT_DECISION" | "ADD_ASSUMPTION" | "REVIEW_CONFLICT" | "SUPERSEDE_DECISION" | "PROFILE_SUGGESTION";

interface ApprovalRow {
  approval: {
    id: string;
    kind: Kind;
    status: string;
    reason: string;
    requestedByType: string;
    requestedByLabel: string | null;
    relatedDecisionIds: string[];
    conflictId: string | null;
    payload: {
      related?: Array<{ decisionId: string; reintroducesRejectedAlternative: boolean; reasons: string[] }>;
      suggestion?: string;
      alias?: string;
      canonical?: string;
    } | null;
    createdAt: string;
  };
  decision: DecisionWithDetails | null;
  related: DecisionWithDetails[];
}

const KIND_LABEL: Record<Kind, string> = {
  COMMIT_DECISION: "Proposed decision",
  ADD_ASSUMPTION: "Proposed assumption",
  REVIEW_CONFLICT: "Evidence review",
  SUPERSEDE_DECISION: "Supersession",
  PROFILE_SUGGESTION: "Suggested rule",
};

type Action = "approve" | "reject" | "request_evidence" | "link" | "supersede_old";

/**
 * Everything waiting for a person. Agents and integrations propose; nothing
 * becomes authoritative until someone approves it here.
 */
export default function ApprovalsPage() {
  const { data, isLoading, error } = useV1<ApprovalRow[]>(["approvals"], "/approvals");
  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="Proposals from agents, evidence that would invalidate an important assumption, and suggested rules. Nothing here takes effect until a person approves it."
      />
      <QueryState loading={isLoading} error={error as Error | null} />
      {!isLoading &&
        !error &&
        (rows.length === 0 ? (
          <EmptyState title="Nothing is waiting for review">Agents propose decisions with decisionloop_propose_decision.</EmptyState>
        ) : (
          <div className="space-y-6">
            {rows.map((row) => (
              <ApprovalItem key={row.approval.id} row={row} />
            ))}
          </div>
        ))}
    </div>
  );
}

function ApprovalItem({ row }: { row: ApprovalRow }) {
  const { approval, decision, related } = row;
  const [note, setNote] = useState("");
  const resolve = useV1Mutation((action: Action) => v1(`/approvals/${approval.id}`, { body: { action, note: note || null } }));
  const flagged = new Set((approval.payload?.related ?? []).filter((r) => r.reintroducesRejectedAlternative).map((r) => r.decisionId));
  const chosen = decision?.options.find((o) => o.isChosen);
  const isRule = approval.kind === "PROFILE_SUGGESTION";

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-400">
            {KIND_LABEL[approval.kind]}, from {approval.requestedByLabel ?? approval.requestedByType} <When iso={approval.createdAt} />
            {approval.status === "NEEDS_EVIDENCE" && <span className="ml-2 text-amber-700">waiting for evidence</span>}
          </p>
          {decision && (
            <h2 className="text-base">
              <Link href={`/decisions/${decision.id}`} className="hover:underline">
                {decision.title}
              </Link>
            </h2>
          )}
        </div>
        {decision && <DecisionStatusBadge status={decision.status} />}
      </div>

      <div className="space-y-4 px-4 py-3 text-sm">
        <p className={flagged.size ? "text-amber-700" : "text-ink-200"}>{approval.reason}</p>

        {isRule && approval.payload?.alias && (
          <dl className="kv">
            <dt>Treat</dt>
            <dd className="font-mono">{approval.payload.alias}</dd>
            <dt>as the same as</dt>
            <dd className="font-mono">{approval.payload.canonical}</dd>
            <dt>Effect</dt>
            <dd>Future evidence using the first name is compared with assumptions using the second by code, with no model call.</dd>
          </dl>
        )}

        {decision && approval.kind === "COMMIT_DECISION" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="eyebrow">Chosen</p>
              <p>{chosen?.name ?? "—"}</p>
              {decision.reasoning && <p className="mt-1 text-ink-400">{decision.reasoning}</p>}
              {decision.options
                .filter((o) => !o.isChosen)
                .map((o) => (
                  <p key={o.id} className="mt-1 text-ink-400">
                    Rejected {o.name}
                    {o.rejectionReason ? `: ${o.rejectionReason}` : ""}
                  </p>
                ))}
            </div>
            <div>
              <p className="eyebrow">Assumptions</p>
              {decision.assumptions.length === 0 ? (
                <p className="text-ink-500">None recorded. Consider asking for them.</p>
              ) : (
                decision.assumptions.map((a) => (
                  <p key={a.id} className="text-ink-300">
                    {a.statement}
                    {a.normalizedStatement && <span className="ml-1 font-mono text-xs text-ink-500">({a.normalizedStatement})</span>}
                  </p>
                ))
              )}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div>
            <p className="eyebrow">Existing decisions this bears on</p>
            {related.map((d) => (
              <p key={d.id} className={flagged.has(d.id) ? "text-amber-700" : "text-ink-300"}>
                <Link href={`/decisions/${d.id}`} className="underline">
                  {d.externalRef ? `${d.externalRef}: ` : ""}
                  {d.title}
                </Link>{" "}
                <span className="text-ink-500">({d.status.toLowerCase().replace("_", " ")})</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-ink-700 px-4 py-3">
        <label className="label" htmlFor={`note-${approval.id}`}>
          Note (optional, kept in the record)
        </label>
        <input id={`note-${approval.id}`} className="input mb-3" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate("approve")}>
            {approval.kind === "REVIEW_CONFLICT" ? "Accept evidence" : isRule ? "Apply rule" : "Approve"}
          </button>
          {approval.kind === "COMMIT_DECISION" && related.length > 0 && (
            <button className="btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate("supersede_old")}>
              Approve and supersede the old one
            </button>
          )}
          {approval.kind !== "REVIEW_CONFLICT" && !isRule && (
            <button className="btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate("request_evidence")}>
              Ask for evidence
            </button>
          )}
          {approval.kind === "COMMIT_DECISION" && related.length > 0 && (
            <button className="btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate("link")}>
              Duplicate, link to existing
            </button>
          )}
          <button className="btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate("reject")}>
            {approval.kind === "REVIEW_CONFLICT" ? "Dismiss as false positive" : "Reject"}
          </button>
        </div>
        {resolve.error && (
          <p role="alert" className="mt-2 text-sm text-risk-600">
            {(resolve.error as Error).message}
          </p>
        )}
      </div>
    </section>
  );
}
