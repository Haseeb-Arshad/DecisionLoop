"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLogin } from "@/lib/queries";
import { AuthFrame } from "@/components/AuthFrame";
export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <AuthFrame>
      <div className="w-full max-w-[380px]">
        <p className="eyebrow">Your decision workspace</p>
        <h1 className="text-3xl font-semibold">Welcome back.</h1>
        <p className="mb-8 mt-3 text-sm leading-6 text-ink-400">
          Sign in to pick up the reasoning where you left it.
        </p>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await login.mutateAsync({ email, password });
              router.push("/dashboard");
            } catch {}
          }}
        >
          <label className="label">
            Email
            <input
              className="input mt-2"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="label">
            Password
            <input
              className="input mt-2"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {login.error && (
            <p role="alert" className="text-sm text-risk-600">
              {login.error.message}
            </p>
          )}
          <button className="btn-primary w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in →"}
          </button>
        </form>
        <p className="mt-7 border-t border-ink-700 pt-6 text-xs text-ink-400">
          Setting up a workspace?{" "}
          <Link href="/signup" className="font-medium text-signal-600">
            Create an account
          </Link>
        </p>
        <Link href="/" className="mt-7 inline-block text-xs text-ink-500">
          ← About DecisionLoop
        </Link>
      </div>
    </AuthFrame>
  );
}
