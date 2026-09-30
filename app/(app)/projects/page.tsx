"use client";
import Link from "next/link";
import { useState } from "react";
import { useCreateProject, useProjects } from "@/lib/queries";
import { PageHeader, QueryState, EmptyState } from "@/components/Workspace";
export default function ProjectsPage() {
  const q = useProjects();
  const create = useCreateProject();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await create.mutateAsync({ name, description: description || undefined });
      setName("");
      setDescription("");
      setShowForm(false);
    } catch {
      /* The mutation error is displayed inline. */
    }
  }
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Organize the record"
        title="Projects"
        description="Browse the work behind your decisions and their supporting source documents."
        action={
          <button
            className="btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "+ New project"}
          </button>
        }
      />
      {showForm && (
        <form onSubmit={submit} className="card form-section mb-6">
          <h2>Create a project</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="label">
              Name
              <input
                required
                maxLength={120}
                className="input mt-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="label">
              Description
              <input
                maxLength={2000}
                className="input mt-2"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          {create.error && (
            <p role="alert" className="mb-4 text-sm text-risk-600">
              {create.error.message}
            </p>
          )}
          <button className="btn-primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create project"}
          </button>
        </form>
      )}
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
      {q.data &&
        (q.data.projects.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {q.data.projects.map((project) => (
              <Link
                href={`/projects/${project.id}`}
                className="card form-section block transition hover:border-signal-600/40"
                key={project.id}
              >
                <p className="record-reference mb-3">
                  PROJECT / {project.name.slice(0, 3).toUpperCase()}
                </p>
                <h2>{project.name}</h2>
                <p className="mt-3 min-h-[3rem] text-xs leading-6 text-ink-400">
                  {project.description ??
                    "A collection of decisions and source evidence."}
                </p>
                <div className="mt-5 flex justify-between border-t border-ink-700 pt-4 text-xs text-ink-400">
                  <span>
                    {project.decisionCount} decisions · {project.documentCount}{" "}
                    sources
                  </span>
                  {project.atRiskCount > 0 ? (
                    <span className="text-risk-600">
                      {project.atRiskCount} at risk
                    </span>
                  ) : (
                    <span>↗</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No projects recorded">
            Create a project to organize your source documents and browse its
            decision history.
          </EmptyState>
        ))}
    </div>
  );
}
