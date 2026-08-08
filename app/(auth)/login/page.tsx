"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLogin } from "@/lib/queries";

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      router.push("/decisions");
    } catch {
      // error surfaced via login.error below
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <Link href="/" className="mb-8 inline-flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-signal-500 text-xs font-bold text-ink-950">
            D
          </div>
          <span className="text-sm font-semibold">DecisionLoop</span>
        </Link>

        <h1 className="mb-1 text-xl font-semibold text-ink-50">Sign in</h1>
        <p className="mb-6 text-sm text-ink-400">Welcome back to your workspace.</p>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
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
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {login.isError && (
            <p className="text-sm text-risk-400">{(login.error as Error).message}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-400">
          No workspace yet?{" "}
          <Link href="/signup" className="text-signal-400 hover:text-signal-300">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
