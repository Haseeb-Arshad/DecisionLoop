"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useV1 } from "@/lib/v1";

interface History {
  decision: {
    id: string;
    title: string;
    externalRef: string | null;
    assumptions: Array<{ id: string; statement: string; validityStatus: string }>;
  };
}

interface Radius {
  root: { assumptionId: string | null; decisionId: string; label: string };
  nodes: Array<{ decisionId: string; title: string; externalRef: string | null; status: string; depth: number }>;
  edges: Array<{ from: string; to: string; relationship: string; importance: number; viaAssumption: string | null }>;
  truncated: boolean;
}

/**
 * Decision blast radius (spec §22): if this assumption changes, what else
 * might be affected? Drawn only from recorded dependencies — a decision
 * appears here because someone recorded that it depends on this one, never
 * because it looks related.
 */
export default function ImpactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [assumptionId, setAssumptionId] = useState<string | null>(null);
  const history = useV1<History>(["decision", id], `/decisions/${id}`);
  const query = `/decisions/${id}/blast-radius${assumptionId ? `?assumptionId=${assumptionId}` : ""}`;
  const radius = useV1<Radius>(["radius", id, assumptionId ?? "decision"], query);
  const d = history.data?.decision;

  const childrenOf = (nodeId: string) => (radius.data?.edges ?? []).filter((e) => e.to === nodeId);
  const nodeById = new Map((radius.data?.nodes ?? []).map((n) => [n.decisionId, n]));

  function Branch({ nodeId, seen }: { nodeId: string; seen: Set<string> }) {
    const kids = childrenOf(nodeId).filter((e) => !seen.has(e.from));
    if (kids.length === 0) return null;
    return (
      <ul className="ml-5 border-l border-ink-800 pl-4">
        {kids.map((e) => {
          const n = nodeById.get(e.from);
          if (!n) return null;
          const next = new Set(seen).add(e.from);
          return (
            <li key={`${e.from}-${e.to}`} className="py-1.5">
              <Link href={`/decisions/${n.decisionId}`} className="text-sm text-ink-200 hover:underline">
                {n.externalRef ? `${n.externalRef} — ` : ""}
                {n.title}
              </Link>
              <span className={`ml-2 text-xs ${n.status === "AT_RISK" ? "text-risk-600" : "text-ink-500"}`}>[{n.status}]</span>
              <span className="ml-2 text-xs text-ink-500">
                {e.relationship.toLowerCase().replace(/_/g, " ")}
                {e.viaAssumption ? " this assumption" : ""}
              </span>
              <Branch nodeId={n.decisionId} seen={next} />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/decisions/${id}`} className="text-xs text-ink-500 hover:underline">
          ← Decision
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-50">Blast radius</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          What else depends on {d ? `“${d.externalRef ?? d.title}”` : "this decision"}. Only recorded dependencies are
          shown; nothing is inferred.
        </p>
      </div>

      {d && d.assumptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button className={assumptionId === null ? "btn-primary" : "btn-secondary"} onClick={() => setAssumptionId(null)}>
            Whole decision
          </button>
          {d.assumptions.map((a) => (
            <button key={a.id} className={assumptionId === a.id ? "btn-primary" : "btn-secondary"} onClick={() => setAssumptionId(a.id)}>
              If “{a.statement}” changes
            </button>
          ))}
        </div>
      )}

      <div className="card p-5">
        {radius.error ? (
          <p className="text-sm text-risk-600">{(radius.error as Error).message}</p>
        ) : !radius.data ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-ink-100">{radius.data.root.label}</p>
            {radius.data.edges.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">
                No recorded decision depends on this. Record dependencies with <code className="font-mono">dependsOn</code> when
                proposing or committing a decision.
              </p>
            ) : (
              <Branch nodeId={radius.data.root.decisionId} seen={new Set([radius.data.root.decisionId])} />
            )}
            {radius.data.truncated && <p className="mt-3 text-xs text-ink-500">Truncated at the maximum depth.</p>}
          </>
        )}
      </div>
    </div>
  );
}
