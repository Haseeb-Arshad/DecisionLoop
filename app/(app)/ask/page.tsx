"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useV1Mutation, v1 } from "@/lib/v1";
import type { ContextResponse } from "@decisionloop/core/services/context";
export default function AskPage() {
  const [intent, setIntent] = useState("");
  const [resources, setResources] = useState("");
  const context = useV1Mutation<unknown, ContextResponse>((body) =>
    v1("/context", { body }),
  );
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Before the next change"
        title="Find the decisions that matter."
        description="Describe what you plan to do. Retrieve the choices, constraints, and conditions relevant to that work."
      />
      <form
        className="card form-section"
        onSubmit={(e) => {
          e.preventDefault();
          context.mutate({
            intent,
            resources: resources
              .split(/[\n,]/)
              .map((x) => x.trim())
              .filter(Boolean),
          });
        }}
      >
        <label className="label">
          What are you working on?
          <textarea
            required
            maxLength={2000}
            rows={3}
            className="input mt-2"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Change how the app caches user sessions"
          />
        </label>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="label mb-0 flex-1">
            Files or dependencies (optional)
            <input
              className="input mt-2"
              value={resources}
              onChange={(e) => setResources(e.target.value)}
              placeholder="src/auth/session.ts, npm:redis"
            />
          </label>
          <button className="btn-primary shrink-0" disabled={context.isPending}>
            {context.isPending
              ? "Finding context…"
              : "Find relevant decisions →"}
          </button>
        </div>
      </form>
      {context.error && (
        <p role="alert" className="mt-5 text-sm text-risk-600">
          {context.error.message}
        </p>
      )}
      {context.data && (
        <section className="mt-8">
          <div className="mb-4 flex justify-between">
            <h2 className="section-label !mb-0">Retrieved context</h2>
            <span className="text-xs text-ink-400">
              {context.data.decisions.length} decisions · ~
              {context.data.tokenEstimate} tokens
            </span>
          </div>
          {context.data.decisions.length ? (
            <div className="space-y-4">
              {context.data.decisions.map((d) => (
                <article key={d.id} className="card form-section">
                  <div className="flex justify-between gap-5">
                    <Link
                      href={`/decisions/${d.id}`}
                      className="text-lg font-semibold hover:text-signal-600"
                    >
                      {d.title} ↗
                    </Link>
                    <DecisionStatusBadge status={d.status} />
                  </div>
                  <p className="mt-3 text-xs text-signal-600">
                    Matched by {d.matchedBy.join(", ")}
                  </p>
                  <p className="mt-4 text-sm font-medium">Chose {d.chosen}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-400">
                    {d.rationale}
                  </p>
                  {d.assumptions.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-ink-700 pt-4">
                      {d.assumptions.map((a) => (
                        <li className="text-xs leading-6" key={a.id}>
                          <span className="text-ink-400">
                            [{a.validity.toLowerCase()}]
                          </span>{" "}
                          {a.statement}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.constraints.map((c) => (
                    <p key={c.id} className="mt-3 text-xs text-risk-600">
                      {c.severity}: {c.statement}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No relevant decisions found">
              Try a specific resource or phrase, or record the decision that
              governs this work.
            </EmptyState>
          )}
          <p className="mt-5 text-xs leading-6 text-ink-400">
            This is retrieved decision context. Relevance depends on the
            recorded resources and the configured embedding provider.
          </p>
        </section>
      )}
      {!context.data && !context.isPending && (
        <div className="mt-8">
          <EmptyState title="Bring the reasoning into your next task">
            Search works without a reasoning model. Specific paths and
            dependency names help retrieve the right choice.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
