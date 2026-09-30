"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSignup } from "@/lib/queries";
import { AuthFrame } from "@/components/AuthFrame";
export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const setup = useQuery<{
    available: boolean;
    local: boolean;
    workspaceName: string | null;
  }>({
    queryKey: ["signup-availability"],
    queryFn: async () => {
      const r = await fetch("/api/auth/signup");
      if (!r.ok) throw new Error("Unable to check workspace setup.");
      return r.json();
    },
  });
  return (
    <AuthFrame>
      <div className="w-full">
        <h1 className="text-xl">{setup.data?.local ? "Set up your local account" : "Create a workspace"}</h1>
        <p className="mb-6 mt-1 text-sm text-ink-400">
          {setup.data?.local
            ? "This account uses the same workspace as your CLI and agents."
            : "A private workspace for your team's decisions."}
        </p>
        {setup.isLoading ? (
          <p role="status" className="text-sm text-ink-400">
            Checking workspace setup…
          </p>
        ) : setup.error ? (
          <p role="alert" className="text-sm text-risk-600">
            {setup.error.message}
          </p>
        ) : !setup.data?.available ? (
          <div className="card p-5">
            <p className="text-sm text-ink-400">
              Account registration is closed for this instance. Use an existing
              account or ask its administrator for access.
            </p>
            <Link href="/login" className="btn-primary mt-5">
              Sign in
            </Link>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await signup.mutateAsync({
                  workspaceName: setup.data?.workspaceName ?? workspaceName,
                  name,
                  email,
                  password,
                });
                router.push("/dashboard");
              } catch {}
            }}
          >
            {!setup.data.local && (
              <label className="label">
                Workspace name
                <input
                  className="input mt-2"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Platform team"
                />
              </label>
            )}
            <label className="label">
              Your name
              <input
                className="input mt-2"
                required
                maxLength={120}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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
                minLength={8}
                maxLength={200}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            {signup.error && (
              <p role="alert" className="text-sm text-risk-600">
                {signup.error.message}
              </p>
            )}
            <button className="btn-primary w-full" disabled={signup.isPending}>
              {signup.isPending ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
        <p className="mt-6 text-xs text-ink-400">
          Already have an account?{" "}
          <Link className="text-signal-600 underline" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
