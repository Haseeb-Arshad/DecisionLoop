"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useV1Mutation, v1 } from "@/lib/v1";
import type { ActionCheck, ContextResponse } from "@decisionloop/core/services/context";

const splitList = (text: string) =>
  text
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

const VERDICT_TEXT: Record<ActionCheck["verdict"], { label: string; className: string }> = {
  stop: { label: "Stop", className: "status status-risk" },
  caution: { label: "Caution", className: "status status-warn" },
  clear: { label: "Clear", className: "status status-active" },
  no_decision: { label: "No decision governs this", className: "status status-muted" },
};

export default function AskPage() {
  return (
    <div>
      <PageHeader
        title="Find context"
        description="Ask what governs some work, or check an action before it happens. Both work without a reasoning model."
      />
      <div className="space-y-10">
        <ContextForm />
        <ActionForm />
      </div>
    </div>
  );
}

function ContextForm() {
  const [intent, setIntent] = useState("");
  const [resources, setResources] = useState("");
  const context = useV1Mutation<unknown, ContextResponse>((body) => v1("/context", { body }));

  return (
    <section>
      <h2 className="section-label">What governs this work?</h2>
      <form
        className="card form-section"
        onSubmit={(e) => {
          e.preventDefault();
          context.mutate({ intent, resources: splitList(resources) });
        }}
      >
        <label className="label" htmlFor="ctx-intent">
          What are you about to do?
        </label>
        <textarea id="ctx-intent" required maxLength={2000} rows={2} className="input" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="Change how sessions are stored, or: answer a refund request" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="ctx-resources">
              What does it touch? (optional)
            </label>
            <input id="ctx-resources" className="input" value={resources} onChange={(e) => setResources(e.target.value)} placeholder="src/auth/session.ts, npm:redis, policy:refunds, vendor:acme" />
          </div>
          <button className="btn-primary shrink-0" disabled={context.isPending}>
            {context.isPending ? "Searching…" : "Find decisions"}
          </button>
        </div>
      </form>
      {context.error && (
        <p role="alert" className="mt-3 text-sm text-risk-600">
          {context.error.message}
        </p>
      )}
      {context.data &&
        (context.data.decisions.length ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-ink-400">
              {context.data.decisions.length} decisions, about {context.data.tokenEstimate} tokens
            </p>
            <div className="card">
              {context.data.decisions.map((d) => (
                <article key={d.id} className="border-b border-ink-700/60 px-4 py-3 last:border-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link href={`/decisions/${d.id}`} className="font-medium hover:underline">
                      {d.externalRef && <span className="record-reference mr-2">{d.externalRef}</span>}
                      {d.title}
                    </Link>
                    <DecisionStatusBadge status={d.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-400">Matched by {d.matchedBy.join("; ")}</p>
                  <p className="mt-2 text-sm">Chose: {d.chosen ?? "—"}</p>
                  {d.rationale && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-300">{d.rationale}</p>}
                  {d.assumptions.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {d.assumptions.map((a) => (
                        <li key={a.id}>
                          <span className="text-ink-400">{a.validity.toLowerCase()}:</span> {a.statement}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.constraints.map((c) => (
                    <p key={c.id} className="mt-1 text-sm text-risk-600">
                      {c.severity.toLowerCase()}: {c.statement}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="No recorded decision matched">Try a specific resource such as a path, package, customer, vendor or policy.</EmptyState>
          </div>
        ))}
    </section>
  );
}

function ActionForm() {
  const [action, setAction] = useState("");
  const [resources, setResources] = useState("");
  const [predicate, setPredicate] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [subject, setSubject] = useState("");
  const check = useV1Mutation<unknown, ActionCheck>((body) => v1("/actions/check", { body }));

  const numeric = value.trim() !== "" && !Number.isNaN(Number(value));

  return (
    <section>
      <h2 className="section-label">Would this action break a decision?</h2>
      <form
        className="card form-section"
        onSubmit={(e) => {
          e.preventDefault();
          check.mutate({
            action,
            resources: splitList(resources),
            facts:
              predicate.trim() && value.trim()
                ? [
                    {
                      subject: subject.trim() || null,
                      predicate: predicate.trim(),
                      valueType: numeric ? "NUMBER" : "CATEGORY",
                      value: numeric ? Number(value) : value.trim(),
                      unit: unit.trim() || null,
                      statement: `${predicate.trim()} = ${value.trim()}${unit.trim() ? ` ${unit.trim()}` : ""}`,
                    },
                  ]
                : [],
          });
        }}
      >
        <label className="label" htmlFor="act-action">
          What will the action do?
        </label>
        <input id="act-action" required className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Refund order 1234 for $350" />
        <label className="label mt-4" htmlFor="act-resources">
          What does it touch?
        </label>
        <input id="act-resources" className="input" value={resources} onChange={(e) => setResources(e.target.value)} placeholder="policy:refunds, customer:acme" />
        <p className="form-hint mt-4">A value the action would use, compared with constraints by code (optional).</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <input aria-label="Subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject, e.g. vendor:acme" />
          <input aria-label="Value name" className="input" value={predicate} onChange={(e) => setPredicate(e.target.value)} placeholder="Name, e.g. refund_amount_usd" />
          <input aria-label="Value" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value, e.g. 350" />
          <input aria-label="Unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit, e.g. USD" />
        </div>
        <button className="btn-primary mt-4" disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check action"}
        </button>
      </form>
      {check.error && (
        <p role="alert" className="mt-3 text-sm text-risk-600">
          {check.error.message}
        </p>
      )}
      {check.data && (
        <div className="card mt-4 px-4 py-3" aria-live="polite">
          <p className="mb-2">
            <span className={VERDICT_TEXT[check.data.verdict].className}>{VERDICT_TEXT[check.data.verdict].label}</span>
          </p>
          {check.data.violations.map((v) => (
            <p key={v.constraintId} className="text-sm text-risk-600">
              Breaks{" "}
              <Link className="underline" href={`/decisions/${v.decision.id}`}>
                {v.decision.externalRef ?? v.decision.title}
              </Link>{" "}
              ({v.severity.toLowerCase()}): {v.explanation}
            </p>
          ))}
          {check.data.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-700">
              {w}
            </p>
          ))}
          {check.data.violations.length === 0 && check.data.warnings.length === 0 && check.data.verdict !== "no_decision" && (
            <p className="text-sm text-ink-300">No constraint is broken and no governing decision is in doubt.</p>
          )}
          <p className="mt-2 text-xs text-ink-400">Advisory only. Nothing was recorded as evidence.</p>
        </div>
      )}
    </section>
  );
}
