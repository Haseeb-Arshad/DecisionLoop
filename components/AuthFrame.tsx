import Link from "next/link";
import type { ReactNode } from "react";
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand !p-0 !text-white" href="/">
          <span className="brand-mark !bg-white/15">↗</span>
          <span>DecisionLoop</span>
        </Link>
        <div className="auth-story-copy">
          <p className="text-[10px] uppercase tracking-[.2em] text-white/50">
            A shared record of the why
          </p>
          <h2>
            Good decisions
            <br />
            deserve a memory.
          </h2>
          <p>
            Keep the choice, the tradeoff, and the assumptions. When the world
            changes, the reasoning stays within reach.
          </p>
          <div className="auth-record">
            <p className="text-[10px] uppercase tracking-wider text-white/50">
              The record
            </p>
            <p className="mt-5 text-lg">
              Choice → Reason → Condition → Evidence
            </p>
            <p className="mt-4 !text-xs !leading-6 !text-white/60">
              People make the judgment.
              <br />
              DecisionLoop preserves the context.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-white/40">
          Human decisions. Traceable evidence.
        </p>
      </section>
      <section className="auth-form-panel">{children}</section>
    </main>
  );
}
