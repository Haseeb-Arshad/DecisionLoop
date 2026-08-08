"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSignup } from "@/lib/queries";

export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await signup.mutateAsync({ workspaceName, name, email, password });
      router.push("/decisions");
    } catch {
      // error surfaced via signup.error below
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm animate-fade-in">
        <Link href="/" className="mb-8 inline-flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-signal-500 text-xs font-bold text-ink-950">
            D
          </div>
          <span className="text-sm font-semibold">DecisionLoop</span>
        </Link>

        <h1 className="mb-1 text-xl font-semibold text-ink-50">Create your workspace</h1>
        <p className="mb-6 text-sm text-ink-400">
          One workspace per team — every decision, document, and memory trace is scoped to it.
        </p>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="workspaceName">
              Workspace name
            </label>
            <input
              id="workspaceName"
              required
              className="input"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme Platform Team"
            />
          </div>
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              required
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Lee"
            />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          {signup.isError && (
            <p className="text-sm text-risk-400">{(signup.error as Error).message}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={signup.isPending}>
            {signup.isPending ? "Creating workspace…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-400">
          Already have a workspace?{" "}
          <Link href="/login" className="text-signal-400 hover:text-signal-300">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
