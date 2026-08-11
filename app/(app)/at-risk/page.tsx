"use client";

import Link from "next/link";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useDecisions } from "@/lib/queries";

export default function AtRiskPage() {
  const { data, isLoading } = useDecisions({ status: "AT_RISK" });
  const decisions = data?.decisions ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Decisions at risk</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Committed decisions whose supporting assumptions have been contradicted by evidence that
          arrived later. Nothing here was flagged by a person — DecisionLoop recalled each decision
          on its own when new evidence came in.
        </p>
      </div>

      {isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : decisions.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm text-ink-200">Nothing is at risk.</p>
          <p className="mt-1 text-sm text-ink-500">
            Every assumption behind your committed decisions still holds, as far as DecisionLoop
            can tell from the evidence it has seen.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((decision) => {
            const invalid = decision.assumptions.filter(
              (a) => a.validityStatus === "INVALIDATED",
            );
            const challenged = decision.assumptions.filter(
              (a) => a.validityStatus === "CHALLENGED",
            );
            return (
              <Link
                key={decision.id}
                href={`/decisions/${decision.id}`}
                className="card block border-risk-500/30 bg-risk-500/[0.04] p-5 transition hover:border-risk-500/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-medium text-ink-100">{decision.title}</h2>
                    <p className="mt-1 text-sm text-ink-300">
                      {decision.riskExplanation ?? "An assumption behind this decision changed."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                      {invalid.length > 0 && (
                        <span className="text-risk-400">
                          {invalid.length} assumption{invalid.length === 1 ? "" : "s"} invalidated
                        </span>
                      )}
                      {challenged.length > 0 && (
                        <span className="text-amber-400">
                          {challenged.length} challenged
                        </span>
                      )}
                      <span>
                        Chosen: {decision.options.find((o) => o.isChosen)?.name ?? "—"}
                      </span>
                    </div>
                  </div>
                  <DecisionStatusBadge status={decision.status} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
