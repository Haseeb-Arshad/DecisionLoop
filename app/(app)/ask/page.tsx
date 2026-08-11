"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAsk } from "@/lib/queries";

const SUGGESTIONS = [
  "Why did we choose our analytics vendor?",
  "Which decisions are currently at risk, and why?",
  "What assumptions are we relying on for pricing?",
  "What did we reject, and for what reason?",
];

function AskPageInner() {
  const searchParams = useSearchParams();
  const decisionId = searchParams.get("decisionId") ?? undefined;
  const ask = useAsk();
  const [question, setQuestion] = useState("");

  function submit(q: string) {
    if (q.trim().length < 3) return;
    setQuestion(q);
    ask.mutate({ question: q, decisionId });
  }

  const result = ask.data;

  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Ask DecisionLoop</h1>
        <p className="mt-1 text-sm text-ink-400">
          Answers come only from committed organizational memory. If the answer isn&apos;t in
          there, DecisionLoop says so rather than guessing.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="card p-4"
      >
        <textarea
          className="input min-h-[80px] resize-y"
          placeholder="Why did we choose SignalForge?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question);
          }}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">⌘/Ctrl + Enter to ask</p>
          <button className="btn-primary" disabled={ask.isPending || question.trim().length < 3}>
            {ask.isPending ? "Searching memory…" : "Ask"}
          </button>
        </div>
      </form>

      {!result && !ask.isPending && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {ask.isError && (
        <div className="card border-risk-500/40 p-4 text-sm text-risk-400">
          {(ask.error as Error).message}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={`card p-5 ${
              result.answer.groundedInMemory ? "" : "border-amber-500/40 bg-amber-500/[0.04]"
            }`}
          >
            {!result.answer.groundedInMemory && (
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-400">
                Not found in organizational memory
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">
              {result.answer.answer}
            </p>

            {result.answer.citedReferences.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-500">Cited memories:</span>
                {result.answer.citedReferences.map((ref) => (
                  <span key={ref} className="pill bg-ink-700/60 font-mono text-ink-200">
                    {ref}
                  </span>
                ))}
              </div>
            )}

            {result.answer.followUpSuggestion && (
              <p className="mt-3 border-t border-ink-800 pt-3 text-sm text-ink-400">
                {result.answer.followUpSuggestion}
              </p>
            )}
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-xs text-ink-500">
            <span>
              Retrieved {result.retrievedCount} candidate memories in{" "}
              {result.retrievalLatencyMs}ms; {result.usedCount} used in the answer.
            </span>
            <Link
              href={`/inspector${decisionId ? `?decisionId=${decisionId}` : ""}`}
              className="text-signal-400 hover:text-signal-300"
            >
              Inspect the retrieval →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>}>
      <AskPageInner />
    </Suspense>
  );
}
