"use client";

import Link from "next/link";
import { useState } from "react";
import { useCreateProject, useProjects } from "@/lib/queries";

export default function ProjectsPage() {
  const { data, isLoading } = useProjects();
  const createProject = useCreateProject();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const projects = data?.projects ?? [];

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    await createProject.mutateAsync({ name, description: description || undefined });
    setName("");
    setDescription("");
    setShowForm(false);
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-50">Projects</h1>
          <p className="mt-1 text-sm text-ink-400">
            Decisions and the evidence behind them, grouped by the work they belong to.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New project"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="card space-y-3 p-5">
          <div>
            <label className="label" htmlFor="project-name">
              Name
            </label>
            <input
              id="project-name"
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Analytics Infrastructure"
            />
          </div>
          <div>
            <label className="label" htmlFor="project-description">
              Description
            </label>
            <input
              id="project-description"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Vendor selection and platform decisions for the analytics stack"
            />
          </div>
          {createProject.isError && (
            <p className="text-sm text-risk-400">{(createProject.error as Error).message}</p>
          )}
          <button className="btn-primary" disabled={createProject.isPending}>
            {createProject.isPending ? "Creating…" : "Create project"}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm text-ink-300">No projects yet.</p>
          <p className="mt-1 text-sm text-ink-500">
            Create one to group related decisions and their evidence.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="card block p-5 transition hover:border-ink-600"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium text-ink-100">{project.name}</h2>
                {project.atRiskCount > 0 && (
                  <span className="pill bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/30">
                    {project.atRiskCount} at risk
                  </span>
                )}
              </div>
              {project.description && (
                <p className="mt-1.5 line-clamp-2 text-sm text-ink-400">{project.description}</p>
              )}
              <div className="mt-4 flex gap-4 text-xs text-ink-500">
                <span>
                  <span className="text-ink-200">{project.decisionCount}</span> decision
                  {project.decisionCount === 1 ? "" : "s"}
                </span>
                <span>
                  <span className="text-ink-200">{project.documentCount}</span> document
                  {project.documentCount === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
