"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { PageHeader, QueryState, EmptyState } from "@/components/Workspace";
import { useV1Mutation, useV1, v1, timeAgo } from "@/lib/v1";
import { useWorkspace } from "@/lib/workspace";
import { useUploadDocument, useDocuments } from "@/lib/queries";
import type { StoredEvent } from "@decisionloop/core/events/event";
export default function EvidencePage() {
  const [statement, setStatement] = useState("");
  const [subject, setSubject] = useState("");
  const [predicate, setPredicate] = useState("");
  const [type, setType] = useState("NUMBER");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [structured, setStructured] = useState(true);
  const lock = useRef(false);
  const submit = useV1Mutation<
    unknown,
    { eventId: string; created: boolean; status: string }
  >((body) => v1("/evidence", { body }));
  const events = useV1<StoredEvent[]>(["events"], "/events?limit=30", {
    refetchInterval: 3000,
  });
  const ws = useWorkspace();
  const docs = useDocuments();
  const upload = useUploadDocument();
  const file = useRef<HTMLInputElement>(null);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    setError("");
    lock.current = true;
    try {
      const parsed =
        type === "NUMBER"
          ? Number(value)
          : type === "SET"
            ? value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            : type === "BOOLEAN"
              ? value === "true"
              : value;
      if (
        structured &&
        (!value.trim() || (type === "NUMBER" && !Number.isFinite(parsed)))
      )
        throw new Error("Enter a valid observed value.");
      await submit.mutateAsync({
        kind: "OBSERVATION",
        statement,
        subject: subject || null,
        sourceRef: source || null,
        facts: structured
          ? [
              {
                subject,
                predicate,
                valueType: type,
                value: parsed,
                operator: "=",
                unit: unit || null,
                statement,
                quote: statement,
                extractor: "human",
              },
            ]
          : [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
    }
  }
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="What changed in the world?"
        title="Evidence"
        description="Record a measured observation or a source statement. Matching conditions are checked in the background; every result stays traceable."
      />
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,1fr)]">
        <div>
          <form onSubmit={onSubmit} className="card form-section">
            <h2>Submit an observation</h2>
            <p className="form-hint">
              Use the same subject, property, and unit as the condition you want
              to check.
            </p>
            <label className="label">
              What did you observe?
              <textarea
                rows={3}
                maxLength={1000}
                required
                className="input mt-2"
                placeholder="Redis p95 latency reached 30 ms in the load test."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
            </label>
            <label className="mt-4 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={structured}
                onChange={(e) => setStructured(e.target.checked)}
              />{" "}
              Include a structured fact for deterministic checking
            </label>
            {structured && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="label">
                  Subject
                  <input
                    required
                    maxLength={200}
                    className="input mt-2"
                    placeholder="redis"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label className="label">
                  Property
                  <input
                    required
                    maxLength={200}
                    className="input mt-2"
                    placeholder="p95_latency"
                    value={predicate}
                    onChange={(e) => setPredicate(e.target.value)}
                  />
                </label>
                <label className="label">
                  Value type
                  <select
                    className="input mt-2"
                    value={type}
                    onChange={(e) => {
                      setType(e.target.value);
                      setValue("");
                    }}
                  >
                    <option value="NUMBER">Number</option>
                    <option value="BOOLEAN">True / false</option>
                    <option value="CATEGORY">Named value</option>
                    <option value="DATE">Date</option>
                    <option value="VERSION">Version</option>
                    <option value="SET">Set of values</option>
                  </select>
                </label>
                <label className="label">
                  Observed value
                  {type === "BOOLEAN" ? (
                    <select
                      required
                      className="input mt-2"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    >
                      <option value="">Choose a value</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <input
                      required
                      step="any"
                      type={
                        type === "NUMBER"
                          ? "number"
                          : type === "DATE"
                            ? "date"
                            : "text"
                      }
                      className="input mt-2"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  )}
                </label>
                {type === "NUMBER" && (
                  <label className="label">
                    Unit
                    <input
                      maxLength={60}
                      className="input mt-2"
                      placeholder="ms"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
            {!structured && (
              <p className="mt-3 rounded-lg bg-ink-950 p-3 text-xs leading-6 text-ink-400">
                Free text extraction requires a reasoning provider. Without one,
                the observation is stored, and semantic checks remain
                unavailable.
              </p>
            )}
            <label className="label mt-5">
              Source reference (optional)
              <input
                maxLength={2000}
                className="input mt-2"
                placeholder="Report URL, file path, or test run identifier"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="mt-4 text-sm text-risk-600">
                {error}
              </p>
            )}
            {submit.data && (
              <div
                role="status"
                className="mt-4 rounded-lg bg-emerald-50 p-4 text-xs leading-6 text-signal-600"
              >
                {submit.data.created
                  ? "Observation received. Background evaluation is queued."
                  : "This observation is already recorded."}{" "}
                <Link className="underline" href="/triggers">
                  Follow its evaluation →
                </Link>
              </div>
            )}
            <button className="btn-primary mt-5" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit evidence →"}
            </button>
          </form>
          <section className="mt-7">
            <h2 className="section-label">Recent incoming evidence</h2>
            <QueryState
              loading={events.isLoading}
              error={events.error}
              retry={events.refetch}
            />
            {events.data &&
              (events.data.length ? (
                <div className="card">
                  {events.data.map((e) => (
                    <Link href="/triggers" key={e.id} className="record-row">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm line-clamp-2">
                          {e.text ?? e.type}
                        </p>
                        <p className="mt-2 text-[10px] text-ink-400">
                          {e.source} · {timeAgo(e.receivedAt)}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] ${e.status === "FAILED" ? "text-risk-600" : "text-signal-600"}`}
                      >
                        {e.status.toLowerCase()}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="No observations received yet">
                  Start with a fact that could support or challenge a recorded
                  condition.
                </EmptyState>
              ))}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="card form-section">
            <p className="eyebrow">Document sources</p>
            <h2>Attach a source file</h2>
            <p className="form-hint">
              PDF, Markdown or plain text. Document storage uses your configured
              S3 bucket.
            </p>
            {ws.data?.capabilities.documentUpload ? (
              <>
                <input
                  type="file"
                  className="hidden"
                  ref={file}
                  accept=".pdf,.txt,.md"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        await upload.mutateAsync({
                          file: f,
                          sourceType: "INTERNAL_ANALYSIS",
                        });
                      } catch {}
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn-secondary w-full"
                  disabled={upload.isPending}
                  onClick={() => file.current?.click()}
                >
                  {upload.isPending ? "Uploading…" : "Choose a document"}
                </button>
                {upload.error && (
                  <p role="alert" className="mt-3 text-xs text-risk-600">
                    {upload.error.message}
                  </p>
                )}
                {upload.data && (
                  <p role="status" className="mt-3 text-xs text-signal-600">
                    Document received.
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-lg bg-ink-950 p-4 text-xs leading-6 text-ink-400">
                Document upload requires configured storage and a reasoning
                model. You can submit structured observations directly.
              </div>
            )}
          </section>
          <section>
            <h2 className="section-label">Source library</h2>
            <QueryState
              loading={docs.isLoading}
              error={docs.error}
              retry={docs.refetch}
            />
            {docs.data?.documents.length ? (
              <div className="card">
                {docs.data.documents.map((d) => (
                  <Link
                    className="record-row"
                    href={`/documents/${d.id}`}
                    key={d.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {d.filename}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-400">
                        {d.status.toLowerCase()} ·{" "}
                        {d.sourceType.toLowerCase().replaceAll("_", " ")}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              !docs.isLoading && (
                <p className="text-xs leading-6 text-ink-400">
                  Uploaded source documents will appear here.
                </p>
              )
            )}
          </section>
          <section className="rounded-xl border border-ink-700 p-5">
            <h3 className="text-sm font-semibold">
              Keep observations precise.
            </h3>
            <p className="mt-3 text-xs leading-6 text-ink-400">
              “Latency = 30 ms” can check “latency &lt; 20 ms.” A changed
              subject or unit may require a different interpretation.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
