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
    <div>
      <PageHeader
        title="Projects"
        description="Groups of decisions and the documents behind them."
        action={
          <button
            className="btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "New project"}
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
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Decisions</th>
                  <th className="px-3 py-2 text-right font-medium">Sources</th>
                  <th className="px-3 py-2 text-right font-medium">At risk</th>
                </tr>
              </thead>
              <tbody>
                {q.data.projects.map((project) => (
                  <tr key={project.id} className="border-t border-ink-700/60 hover:bg-ink-800">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/projects/${project.id}`} className="hover:underline">
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-300">{project.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{project.decisionCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{project.documentCount}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${project.atRiskCount > 0 ? "text-risk-600" : ""}`}>{project.atRiskCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No projects recorded">
            A project groups decisions and their source documents.
          </EmptyState>
        ))}
    </div>
  );
}
