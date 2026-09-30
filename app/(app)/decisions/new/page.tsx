"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/Workspace";
import { useV1Mutation, v1 } from "@/lib/v1";
import type { DecisionWithDetails } from "@/lib/types";
import {
  OPERATORS_BY_TYPE,
  type ValueType,
} from "@decisionloop/core/assumptions/model";
type Assumption = {
  statement: string;
  subject: string;
  predicate: string;
  valueType: ValueType;
  operator: string;
  expected: string;
  unit: string;
};
const blank = (): Assumption => ({
  statement: "",
  subject: "",
  predicate: "",
  valueType: "TEXT",
  operator: "=",
  expected: "",
  unit: "",
});
export default function NewDecisionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [chosen, setChosen] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState<
    Array<{ name: string; rejectionReason: string }>
  >([]);
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [resources, setResources] = useState("");
  const [repository, setRepository] = useState("");
  const [checkName, setCheckName] = useState("");
  const [checkRepository, setCheckRepository] = useState("");
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const create = useV1Mutation<unknown, DecisionWithDetails>((body) =>
    v1("/decisions?mode=commit", { body }),
  );
  function edit(i: number, patch: Partial<Assumption>) {
    setAssumptions((rows) =>
      rows.map((r, index) => (index === i ? { ...r, ...patch } : r)),
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLock.current) return;
    setError("");
    submitLock.current = true;
    try {
      const rows = assumptions.map((a) => {
        if (!a.statement.trim())
          throw new Error(
            "Write a statement for each assumption, or remove it.",
          );
        if (
          a.valueType !== "TEXT" &&
          (!a.subject.trim() || !a.predicate.trim())
        )
          throw new Error(
            "Checkable assumptions need a subject and a property to match evidence.",
          );
        const expected =
          a.valueType === "NUMBER"
            ? Number(a.expected)
            : a.valueType === "BOOLEAN"
              ? a.expected === "true"
              : ["IN", "NOT_IN"].includes(a.operator)
                ? a.expected
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : a.expected;
        if (a.valueType !== "TEXT" && !a.expected.trim())
          throw new Error(
            "Enter an expected value for each checkable assumption.",
          );
        if (a.valueType === "NUMBER" && !Number.isFinite(expected))
          throw new Error("Expected value must be a valid number.");
        return {
          statement: a.statement.trim(),
          subject: a.subject || null,
          predicate: a.predicate || null,
          valueType: a.valueType,
          operator: a.valueType === "TEXT" ? null : a.operator,
          expected: a.valueType === "TEXT" ? null : expected,
          unit: a.unit || null,
          verificationPolicy:
            a.valueType === "TEXT" ? "MANUAL" : "DETERMINISTIC_FIRST",
          provenance: { source: "human" },
        };
      });
      const d = await create.mutateAsync({
        title: title.trim(),
        problem: problem.trim() || null,
        chosenOption: { name: chosen.trim() },
        rationale: rationale.trim(),
        alternatives: alternatives.filter((a) => a.name.trim()),
        assumptions: rows,
        resources: resources
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        repository: repository.trim() || null,
        verificationChecks: checkName.trim()
          ? [
              {
                name: checkName.trim(),
                repository: checkRepository.trim(),
                kind: "TEST",
              },
            ]
          : [],
      });
      router.push(`/decisions/${d.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to record decision.",
      );
    } finally {
      submitLock.current = false;
    }
  }
  return (
    <div>
      <Link href="/decisions" className="text-xs text-ink-400 underline">
        All decisions
      </Link>
      <div className="mt-3">
        <PageHeader
          title="New decision"
          description="Write the decision in your own words and add assumptions that evidence can be checked against. No model is required."
        />
      </div>
      <form
        onSubmit={submit}
        className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_240px]"
      >
        <div className="space-y-5">
          <section className="card form-section">
            <h2>1. The decision</h2>
            <p className="form-hint">
              What problem did you solve, and what did you choose?
            </p>
            <div className="space-y-5">
              <label className="label">
                Decision title
                <input
                  required
                  maxLength={200}
                  className="input mt-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Use Redis for the session cache"
                />
              </label>
              <label className="label">
                Problem or context
                <textarea
                  maxLength={4000}
                  rows={3}
                  className="input mt-2"
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="What made this decision necessary?"
                />
              </label>
              <label className="label">
                Chosen option
                <input
                  required
                  maxLength={200}
                  className="input mt-2"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  placeholder="Redis"
                />
              </label>
              <label className="label">
                Why this option?
                <textarea
                  required
                  maxLength={8000}
                  rows={4}
                  className="input mt-2"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Explain the tradeoff so someone else can understand it later."
                />
              </label>
            </div>
          </section>
          <section className="card form-section">
            <h2>2. Alternatives</h2>
            <p className="form-hint">
              A rejected option can become useful when circumstances change.
            </p>
            {alternatives.map((a, i) => (
              <div key={i} className="mb-4 rounded bg-ink-800 p-4">
                <div className="mb-3 flex justify-between">
                  <p className="text-xs font-medium">Alternative {i + 1}</p>
                  <button
                    type="button"
                    className="text-xs text-ink-400"
                    onClick={() =>
                      setAlternatives((v) => v.filter((_, n) => i !== n))
                    }
                  >
                    Remove
                  </button>
                </div>
                <label className="label">
                  Option
                  <input
                    required
                    maxLength={200}
                    className="input mt-2"
                    value={a.name}
                    onChange={(e) =>
                      setAlternatives((v) =>
                        v.map((r, n) =>
                          n === i ? { ...r, name: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
                <label className="label mt-3">
                  Why was it rejected?
                  <input
                    maxLength={2000}
                    className="input mt-2"
                    value={a.rejectionReason}
                    onChange={(e) =>
                      setAlternatives((v) =>
                        v.map((r, n) =>
                          n === i
                            ? { ...r, rejectionReason: e.target.value }
                            : r,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={alternatives.length >= 20}
              onClick={() =>
                setAlternatives((v) => [
                  ...v,
                  { name: "", rejectionReason: "" },
                ])
              }
            >
              Add an alternative
            </button>
          </section>
          <section className="card form-section">
            <h2>3. Assumptions to watch</h2>
            <p className="form-hint">
              What must stay true for this choice to make sense?
            </p>
            {assumptions.map((a, i) => (
              <div
                key={i}
                className="mb-4 rounded border border-ink-700 bg-ink-800 p-4"
              >
                <div className="mb-4 flex justify-between">
                  <p className="text-xs font-medium">Assumption {i + 1}</p>
                  <button
                    type="button"
                    className="text-xs text-ink-400"
                    onClick={() =>
                      setAssumptions((v) => v.filter((_, n) => n !== i))
                    }
                  >
                    Remove
                  </button>
                </div>
                <label className="label">
                  Assumption
                  <input
                    required
                    maxLength={1000}
                    className="input mt-2"
                    value={a.statement}
                    onChange={(e) => edit(i, { statement: e.target.value })}
                    placeholder="Session cache latency stays below 20 ms"
                  />
                </label>
                <label className="label mt-4">
                  How should it be checked?
                  <select
                    className="input mt-2"
                    value={a.valueType}
                    onChange={(e) =>
                      edit(i, {
                        valueType: e.target.value as Assumption["valueType"],
                        operator:
                          OPERATORS_BY_TYPE[e.target.value as ValueType][0] ??
                          "=",
                        expected: "",
                      })
                    }
                  >
                    <option value="TEXT">
                      Qualitative statement (reviewed by a person or model)
                    </option>
                    <option value="NUMBER">Measured number</option>
                    <option value="BOOLEAN">True or false</option>
                    <option value="CATEGORY">Category or named value</option>
                    <option value="DATE">Date</option>
                    <option value="VERSION">Version</option>
                    <option value="SET">Set membership</option>
                  </select>
                </label>
                {a.valueType !== "TEXT" && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="label">
                      Subject
                      <input
                        required
                        maxLength={200}
                        className="input mt-2"
                        placeholder="redis"
                        value={a.subject}
                        onChange={(e) => edit(i, { subject: e.target.value })}
                      />
                    </label>
                    <label className="label">
                      Property
                      <input
                        required
                        maxLength={200}
                        className="input mt-2"
                        placeholder="p95_latency"
                        value={a.predicate}
                        onChange={(e) => edit(i, { predicate: e.target.value })}
                      />
                    </label>
                    <label className="label">
                      Comparison
                      <select
                        className="input mt-2"
                        value={a.operator}
                        onChange={(e) => edit(i, { operator: e.target.value })}
                      >
                        {OPERATORS_BY_TYPE[a.valueType].map((op) => (
                          <option key={op}>{op}</option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      Expected value
                      {a.valueType === "BOOLEAN" ? (
                        <select
                          required
                          className="input mt-2"
                          value={a.expected}
                          onChange={(e) =>
                            edit(i, { expected: e.target.value })
                          }
                        >
                          <option value="">Choose a value</option>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <input
                          required
                          className="input mt-2"
                          type={
                            a.valueType === "NUMBER"
                              ? "number"
                              : a.valueType === "DATE"
                                ? "date"
                                : "text"
                          }
                          placeholder={
                            ["IN", "NOT_IN"].includes(a.operator)
                              ? "EU, CH (comma-separated values)"
                              : undefined
                          }
                          step="any"
                          value={a.expected}
                          onChange={(e) =>
                            edit(i, { expected: e.target.value })
                          }
                        />
                      )}
                    </label>
                    {a.valueType === "NUMBER" && (
                      <label className="label">
                        Unit
                        <input
                          className="input mt-2"
                          maxLength={60}
                          placeholder="ms"
                          value={a.unit}
                          onChange={(e) => edit(i, { unit: e.target.value })}
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={assumptions.length >= 50}
              onClick={() => setAssumptions((v) => [...v, blank()])}
            >
              Add an assumption
            </button>
          </section>
          <section className="card form-section">
            <h2>4. What it governs</h2>
            <p className="form-hint">
              Name the things it governs so agents that touch them are told about it: files, packages, customers, vendors, policies.
            </p>
            <label className="label">
              Code repository (optional)
              <input
                className="input mt-2"
                maxLength={200}
                placeholder="owner/repository (optional)"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
              />
            </label>
            <label className="label mt-5">
              Resources
              <textarea
                rows={3}
                className="input mt-2"
                placeholder={"src/auth/**\nnpm:redis\npolicy:refunds\nvendor:*"}
                value={resources}
                onChange={(e) => setResources(e.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-ink-400">
              One per line, as <span className="font-mono">type:name</span> or a path. Wildcards such as <span className="font-mono">vendor:*</span> work for every type.
            </p>
            <details className="mt-6 border-t border-ink-700 pt-5">
              <summary className="cursor-pointer text-sm font-medium">
                Link a GitHub Actions workflow (code decisions)
              </summary>
              <p className="mt-3 text-xs leading-6 text-ink-400">
                Use the exact repository and Actions workflow name. Completed
                runs become evidence; configuration alone does not verify the
                decision.
              </p>
              <label className="label mt-4">
                Workflow name
                <input
                  className="input mt-2"
                  maxLength={200}
                  value={checkName}
                  onChange={(event) => setCheckName(event.target.value)}
                  placeholder="Authentication integration tests"
                />
              </label>
              <label className="label mt-4">
                Workflow repository
                <input
                  className="input mt-2"
                  maxLength={200}
                  required={Boolean(checkName.trim())}
                  value={checkRepository}
                  onChange={(event) => setCheckRepository(event.target.value)}
                  placeholder="owner/repository"
                />
              </label>
            </details>
          </section>
          {error && (
            <p
              role="alert"
              className="rounded border border-risk-500/30 bg-white p-4 text-sm text-risk-600"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Link className="btn-secondary" href="/decisions">
              Cancel
            </Link>
            <button disabled={create.isPending} className="btn-primary">
              {create.isPending ? "Recording…" : "Commit decision"}
            </button>
          </div>
        </div>
        <aside className="card form-section xl:sticky xl:top-8">
          <h2>A useful record</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-300">
            <li>Explains the tradeoff</li>
            <li>Names what was rejected, and why</li>
            <li>States what would change your mind</li>
          </ul>
          <p className="mt-3 text-sm text-ink-400">Committing makes the decision authoritative. Its history stays when evidence changes.</p>
        </aside>
      </form>
    </div>
  );
}
