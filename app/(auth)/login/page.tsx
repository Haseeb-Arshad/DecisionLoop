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
      <div className="w-full">
        <h1 className="text-xl">Sign in</h1>
        <p className="mb-6 mt-1 text-sm text-ink-400">Use the account for this workspace.</p>
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
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-xs text-ink-400">
          No account?{" "}
          <Link href="/signup" className="text-signal-600 underline">
            Create one
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
