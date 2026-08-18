"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { SourceTypeBadge } from "@/components/StatusBadge";
import { SOURCE_TYPE_OPTIONS } from "@/lib/api/uploadTypes";
import {
  useCreateDecision,
  useDocuments,
  useExtractDecision,
  useUploadDocument,
} from "@/lib/queries";
import type { AssumptionOperator, AssumptionType, DocumentSourceType } from "@/lib/types";

interface EditableOption {
  name: string;
  description: string;
  isChosen: boolean;
  rejectionReason: string;
}

interface EditableAssumption {
  statement: string;
  assumptionType: AssumptionType;
  metric: string;
  operator: AssumptionOperator;
  value: string; // controlled input; parsed on submit
  unit: string;
  importance: number;
  confidence: number;
}

const OPERATORS: AssumptionOperator[] = ["<", "<=", ">", ">=", "="];
const ASSUMPTION_TYPES: AssumptionType[] = [
  "QUANTITATIVE",
  "QUALITATIVE",
  "REGULATORY",
  "CAPACITY",
  "TEMPORAL",
];

type Step = "describe" | "review";

/**
 * The §18 New Decision workflow: describe the decision, attach supporting
 * documents, let DecisionLoop analyse both, review what it extracted, then
 * explicitly commit. Nothing enters organizational memory before the final
 * button — the extraction step persists nothing.
 */
export default function NewDecisionPage() {
  const router = useRouter();
  const extract = useExtractDecision();
  const create = useCreateDecision();
  const upload = useUploadDocument();
  const { data: documentsData } = useDocuments();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("describe");
  const [notes, setNotes] = useState("");
  const [sourceType, setSourceType] = useState<DocumentSourceType>("VENDOR_OFFICIAL");
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const commitKeyRef = useRef<string | null>(null);

  const [title, setTitle] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState(0.7);
  const [risks, setRisks] = useState<string[]>([]);
  const [options, setOptions] = useState<EditableOption[]>([]);
  const [assumptions, setAssumptions] = useState<EditableAssumption[]>([]);

  const documents = documentsData?.documents ?? [];
  const processedDocs = documents.filter((d) => d.status === "PROCESSED");
  const attachedDocs = processedDocs.filter((d) => attachedIds.includes(d.id));

  async function onUpload(file: File) {
    const result = await upload.mutateAsync({ file, sourceType });
    setAttachedIds((prev) => [...prev, result.document.id]);
  }

  async function onAnalyse() {
    const result = await extract.mutateAsync({ notes, documentIds: attachedIds });
    setTitle(result.title);
    setProblemStatement(result.problemStatement);
    setReasoning(result.reasoning);
    setConfidence(result.confidence);
    setRisks(result.risks);
    setOptions(result.options);
    setAssumptions(
      result.assumptions.map((a) => ({
        ...a,
        operator: a.operator ?? "=",
        value: a.value === undefined ? "" : String(a.value),
      })),
    );
    setStep("review");
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

  async function onCommit() {
    commitKeyRef.current ??= crypto.randomUUID();
    const result = await create.mutateAsync({
      idempotencyKey: commitKeyRef.current,
      title,
      problemStatement,
      reasoning,
      confidence,
      importance: 0.7,
      evidenceDocumentIds: attachedIds,
      options: options.map((o) => ({
        name: o.name,
        description: o.description,
        isChosen: o.isChosen,
        rejectionReason: o.isChosen ? "" : o.rejectionReason,
      })),
      assumptions: assumptions
        .filter((a) => a.statement.trim())
        .map((a) => ({
          statement: a.statement,
          assumptionType: a.assumptionType,
          metric: a.metric,
          operator: a.value.trim() === "" ? undefined : a.operator,
          value: a.value.trim() === "" ? undefined : Number(a.value),
          unit: a.unit,
          importance: a.importance,
          confidence: a.confidence,
        })),
    });
    router.push(`/decisions/${result.decision.id}`);
  }

  const canAnalyse =
    (notes.trim().length >= 10 || attachedIds.length > 0) && !extract.isPending;
  const canCommit = title.trim().length > 0 && options.some((o) => o.isChosen);

  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Commit a decision</h1>
        <p className="mt-1 text-sm text-ink-400">
          Describe the decision and attach the documents behind it. DecisionLoop extracts the
          options, the reasoning, and the checkable assumptions — you review and edit before
          anything enters organizational memory.
        </p>
      </div>

      <ol className="flex items-center gap-2 text-xs">
        {(["describe", "review"] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                step === s
                  ? "bg-signal-500 text-ink-950"
                  : i === 0
                    ? "bg-ink-700 text-ink-300"
                    : "bg-ink-800 text-ink-500"
              }`}
            >
              {i + 1}
            </span>
            <span className={step === s ? "text-ink-100" : "text-ink-500"}>
              {s === "describe" ? "Describe & attach" : "Review & commit"}
            </span>
            {i === 0 && <span className="ml-1 text-ink-700">→</span>}
          </li>
        ))}
      </ol>

      {step === "describe" && (
        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <div>
              <label className="label" htmlFor="notes">
                Describe the decision
              </label>
              <textarea
                id="notes"
                className="input min-h-[160px] resize-y font-mono text-[13px] leading-relaxed"
                placeholder={
                  "e.g. Choose our analytics infrastructure provider. We evaluated SignalForge " +
                  "and MetricLake. Leaning SignalForge — cheaper at $20K/year, meets our EU " +
                  "residency requirement and current 5M events/day throughput."
                }
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="label !mb-0">Supporting documents</p>
                <p className="mt-1 text-xs text-ink-500">
                  Vendor proposals, architecture reviews, contracts. These become the evidence
                  trail behind the decision.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                className="input max-w-[220px]"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as DocumentSourceType)}
              >
                {SOURCE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={upload.isPending}
              >
                {upload.isPending ? "Uploading…" : "Upload document"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await onUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {upload.isError && (
              <p className="text-sm text-risk-400">{(upload.error as Error).message}</p>
            )}

            {processedDocs.length > 0 && (
              <div className="space-y-1.5">
                {processedDocs.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/40 p-2.5"
                  >
                    <input
                      type="checkbox"
                      className="accent-signal-500"
                      checked={attachedIds.includes(doc.id)}
                      onChange={(e) =>
                        setAttachedIds((prev) =>
                          e.target.checked
                            ? [...prev, doc.id]
                            : prev.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    <span className="flex-1 truncate text-sm text-ink-200">{doc.filename}</span>
                    <SourceTypeBadge
                      sourceType={doc.sourceType}
                      authorityScore={doc.authorityScore}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          {extract.isError && (
            <p className="text-sm text-risk-400">{(extract.error as Error).message}</p>
          )}

          <button className="btn-primary" disabled={!canAnalyse} onClick={onAnalyse}>
            {extract.isPending
              ? "Analysing…"
              : `Analyse${attachedDocs.length > 0 ? ` (${attachedDocs.length} document${attachedDocs.length === 1 ? "" : "s"})` : ""}`}
          </button>
        </div>
      )}

      {step === "review" && (
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
            <div>
              <label className="label">Confidence: {confidence.toFixed(2)}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                className="w-full accent-signal-500"
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <label className="label !mb-0">Options considered</label>
              <button
                className="text-xs text-signal-400 hover:text-signal-300"
                onClick={() =>
                  setOptions((prev) => [
                    ...prev,
                    { name: "", description: "", isChosen: false, rejectionReason: "" },
                  ])
                }
              >
                + Add option
              </button>
            </div>
            <div className="space-y-3">
              {options.map((opt, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    opt.isChosen
                      ? "border-signal-500/50 bg-signal-500/5"
                      : "border-ink-700 bg-ink-900/40"
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
                      onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
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
                  Concrete, checkable claims this decision depends on — these are what
                  DecisionLoop watches for contradictions.
                </p>
              </div>
              <button
                className="text-xs text-signal-400 hover:text-signal-300"
                onClick={() =>
                  setAssumptions((prev) => [
                    ...prev,
                    {
                      statement: "",
                      assumptionType: "QUANTITATIVE",
                      metric: "",
                      operator: "<",
                      value: "",
                      unit: "",
                      importance: 0.6,
                      confidence: 0.7,
                    },
                  ])
                }
              >
                + Add assumption
              </button>
            </div>
            <div className="space-y-3">
              {assumptions.map((a, i) => (
                <div key={i} className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
                  <input
                    className="input mb-2"
                    placeholder="e.g. 'SignalForge pricing stays under $25,000/year'"
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
                      onClick={() =>
                        setAssumptions((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <select
                      className="input max-w-[160px] text-xs"
                      value={a.assumptionType}
                      onChange={(e) =>
                        updateAssumption(i, { assumptionType: e.target.value as AssumptionType })
                      }
                    >
                      {ASSUMPTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-ink-500">
                      importance {a.importance.toFixed(2)}
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        className="accent-signal-500"
                        value={a.importance}
                        onChange={(e) =>
                          updateAssumption(i, { importance: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
              {assumptions.length === 0 && (
                <p className="text-sm text-ink-500">
                  No assumptions extracted. Add at least one — it&apos;s what makes this decision
                  watchable.
                </p>
              )}
            </div>
          </div>

          {risks.length > 0 && (
            <div className="card p-5">
              <p className="label !mb-2">Risks to weigh</p>
              <ul className="space-y-1.5">
                {risks.map((risk, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-300">
                    <span className="text-ink-600">•</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {create.isError && (
            <p className="text-sm text-risk-400">{(create.error as Error).message}</p>
          )}

          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!canCommit || create.isPending} onClick={onCommit}>
              {create.isPending ? "Committing…" : "Commit decision"}
            </button>
            <button className="btn-secondary" onClick={() => setStep("describe")}>
              Back
            </button>
          </div>
          <p className="text-xs text-ink-600">
            Committing writes this decision, its options, and its assumptions to CockroachDB and
            indexes them for retrieval. From then on, new evidence is checked against it
            automatically — in this session and every future one.
          </p>
        </div>
      )}
    </div>
  );
}
