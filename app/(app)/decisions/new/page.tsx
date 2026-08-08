"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCreateDecision, useExtractDecision } from "@/lib/queries";
import type { AssumptionOperator } from "@/lib/types";

interface EditableOption {
  name: string;
  description: string;
  isChosen: boolean;
  rejectionReason: string;
}

interface EditableAssumption {
  statement: string;
  metric: string;
  operator: AssumptionOperator;
  value: string; // kept as string for controlled input, parsed on submit
  unit: string;
}

const OPERATORS: AssumptionOperator[] = ["<", "<=", ">", ">=", "="];

export default function NewDecisionPage() {
  const router = useRouter();
  const extract = useExtractDecision();
  const create = useCreateDecision();

  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [options, setOptions] = useState<EditableOption[]>([]);
  const [assumptions, setAssumptions] = useState<EditableAssumption[]>([]);
  const [extracted, setExtracted] = useState(false);

  async function onExtract() {
    const result = await extract.mutateAsync(notes);
    setTitle(result.title);
    setProblemStatement(result.problemStatement);
    setReasoning(result.reasoning);
    setOptions(result.options);
    setAssumptions(
      result.assumptions.map((a) => ({ ...a, value: String(a.value) })),
    );
    setExtracted(true);
  }

  function updateOption(i: number, patch: Partial<EditableOption>) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  function chooseOption(i: number) {
    setOptions((prev) => prev.map((o, idx) => ({ ...o, isChosen: idx === i })));
  }

  function updateAssumption(i: number, patch: Partial<EditableAssumption>) {
    setAssumptions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function removeAssumption(i: number) {
    setAssumptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addAssumption() {
    setAssumptions((prev) => [
      ...prev,
      { statement: "", metric: "", operator: "<", value: "", unit: "" },
    ]);
  }

  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addOption() {
    setOptions((prev) => [...prev, { name: "", description: "", isChosen: false, rejectionReason: "" }]);
  }

  async function onCommit() {
    const result = await create.mutateAsync({
      title,
      problemStatement,
      reasoning,
      createdInSession: `session-${Date.now()}`,
      options: options.map((o) => ({
        name: o.name,
        description: o.description,
        isChosen: o.isChosen,
        rejectionReason: o.isChosen ? "" : o.rejectionReason,
      })),
      assumptions: assumptions
        .filter((a) => a.statement.trim() && a.value.trim() !== "")
        .map((a) => ({
          statement: a.statement,
          metric: a.metric,
          operator: a.operator,
          value: Number(a.value),
          unit: a.unit,
        })),
    });
    router.push(`/decisions/${result.decision.id}`);
  }

  const canCommit = title.trim().length > 0 && options.some((o) => o.isChosen) && options.length > 0;

  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Commit a decision</h1>
        <p className="mt-1 text-sm text-ink-400">
          Describe what you chose and why. DecisionLoop extracts the options, the reasoning, and
          the checkable assumptions — review and edit before committing to CockroachDB.
        </p>
      </div>

      {!extracted && (
        <div className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="notes">
              Decision notes
            </label>
            <textarea
              id="notes"
              className="input min-h-[180px] resize-y font-mono text-[13px] leading-relaxed"
              placeholder={
                "e.g. We're choosing a workflow automation tool. Considered SignalForge and " +
                "MetricLake. Going with SignalForge — better API, faster support, and pricing " +
                "is under $25,000/year which fits our budget. MetricLake was solid too but " +
                "their enterprise tier starts at $30K."
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {extract.isError && (
            <p className="text-sm text-risk-400">{(extract.error as Error).message}</p>
          )}
          <button
            className="btn-primary"
            disabled={notes.trim().length < 10 || extract.isPending}
            onClick={onExtract}
          >
            {extract.isPending ? "Extracting…" : "Extract structure"}
          </button>
        </div>
      )}

      {extracted && (
        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <div>
              <label className="label">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="label">Problem statement</label>
              <textarea
                className="input min-h-[70px] resize-y"
                value={problemStatement}
                onChange={(e) => setProblemStatement(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Reasoning</label>
              <textarea
                className="input min-h-[90px] resize-y"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
              />
            </div>
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <label className="label !mb-0">Options considered</label>
              <button className="text-xs text-signal-400 hover:text-signal-300" onClick={addOption}>
                + Add option
              </button>
            </div>
            <div className="space-y-3">
              {options.map((opt, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    opt.isChosen ? "border-signal-500/50 bg-signal-500/5" : "border-ink-700 bg-ink-900/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => chooseOption(i)}
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        opt.isChosen ? "border-signal-400 bg-signal-500" : "border-ink-500"
                      }`}
                      aria-label={opt.isChosen ? "Chosen option" : "Mark as chosen"}
                    >
                      {opt.isChosen && <span className="h-1.5 w-1.5 rounded-full bg-ink-950" />}
                    </button>
                    <div className="flex-1 space-y-2">
                      <input
                        className="input"
                        placeholder="Option name"
                        value={opt.name}
                        onChange={(e) => updateOption(i, { name: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="Description"
                        value={opt.description}
                        onChange={(e) => updateOption(i, { description: e.target.value })}
                      />
                      {!opt.isChosen && (
                        <input
                          className="input"
                          placeholder="Why it wasn't chosen"
                          value={opt.rejectionReason}
                          onChange={(e) => updateOption(i, { rejectionReason: e.target.value })}
                        />
                      )}
                    </div>
                    <button
                      className="text-xs text-ink-500 hover:text-risk-400"
                      onClick={() => removeOption(i)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <label className="label !mb-0">Assumptions</label>
                <p className="mt-1 text-xs text-ink-500">
                  Concrete, checkable claims this decision depends on — DecisionLoop watches these.
                </p>
              </div>
              <button
                className="text-xs text-signal-400 hover:text-signal-300"
                onClick={addAssumption}
              >
                + Add assumption
              </button>
            </div>
            <div className="space-y-3">
              {assumptions.map((a, i) => (
                <div key={i} className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
                  <input
                    className="input mb-2"
                    placeholder="Statement, e.g. 'SignalForge pricing stays under $25,000/year'"
                    value={a.statement}
                    onChange={(e) => updateAssumption(i, { statement: e.target.value })}
                  />
                  <div className="grid grid-cols-[1fr_auto_1fr_1fr_auto] gap-2">
                    <input
                      className="input"
                      placeholder="metric"
                      value={a.metric}
                      onChange={(e) => updateAssumption(i, { metric: e.target.value })}
                    />
                    <select
                      className="input"
                      value={a.operator}
                      onChange={(e) =>
                        updateAssumption(i, { operator: e.target.value as AssumptionOperator })
                      }
                    >
                      {OPERATORS.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      placeholder="value"
                      type="number"
                      value={a.value}
                      onChange={(e) => updateAssumption(i, { value: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder="unit"
                      value={a.unit}
                      onChange={(e) => updateAssumption(i, { unit: e.target.value })}
                    />
                    <button
                      className="text-xs text-ink-500 hover:text-risk-400"
                      onClick={() => removeAssumption(i)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {assumptions.length === 0 && (
                <p className="text-sm text-ink-500">
                  No assumptions extracted. Add at least one — it's what makes this decision
                  watchable.
                </p>
              )}
            </div>
          </div>

          {create.isError && (
            <p className="text-sm text-risk-400">{(create.error as Error).message}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={!canCommit || create.isPending}
              onClick={onCommit}
            >
              {create.isPending ? "Committing…" : "Commit decision"}
            </button>
            <button className="btn-secondary" onClick={() => setExtracted(false)}>
              Back to notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
