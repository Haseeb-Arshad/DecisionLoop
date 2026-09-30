import Link from "next/link";
import type { ReactNode } from "react";

/** Sign-in and sign-up: a centered form, nothing else. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <div className="w-full max-w-[360px]">
        <Link className="brand !px-0" href="/">
          DecisionLoop
        </Link>
        <section className="auth-form-panel mt-6">{children}</section>
      </div>
    </main>
  );
}
