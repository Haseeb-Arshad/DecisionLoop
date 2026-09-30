"use client";
import Link from "next/link";
import { PageHeader, QueryState, EmptyState } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/lib/workspace";
export default function AtRiskPage() {
  const q = useWorkspace();
  const rows =
    q.data?.decisions.filter(
      (d) => d.status === "AT_RISK" || d.status === "REOPENED",
    ) ?? [];
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Evidence calls for a judgment"
        title="Attention queue"
        description="Choices with challenged assumptions or an open reconsideration. Review the evidence before deciding what changes."
        action={
          <Link href="/documents" className="btn-secondary">
            Submit evidence
          </Link>
        }
      />
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
      {q.data &&
        (rows.length ? (
          <div className="space-y-4">
            {rows.map((d) => (
              <Link
                href={`/decisions/${d.id}`}
                key={d.id}
                className="card block border-l-[3px] border-l-risk-500 p-6 transition hover:bg-ink-900/50"
              >
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="record-reference">
                      {d.externalRef ?? d.id.slice(0, 8)}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold">{d.title}</h2>
                    <p className="mt-3 text-sm leading-7 text-ink-400">
                      {d.riskExplanation ??
                        "This choice is open for reconsideration."}
                    </p>
                    <p className="mt-4 text-xs text-risk-600">
                      {
                        d.assumptions.filter(
                          (a) =>
                            a.validityStatus === "CHALLENGED" ||
                            a.validityStatus === "INVALIDATED",
                        ).length
                      }{" "}
                      challenged or invalidated conditions
                    </p>
                  </div>
                  <DecisionStatusBadge status={d.status} />
                </div>
                <p className="mt-5 text-xs font-medium text-signal-600">
                  Read the record & review evidence →
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No choices need attention right now">
            No recorded conflicts or reopened decisions are waiting here.
            Evidence checks only cover what has been observed.
          </EmptyState>
        ))}
    </div>
  );
}
