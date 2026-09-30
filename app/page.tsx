import Link from "next/link";
export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link className="brand !p-0" href="/">
          <span className="brand-mark">↗</span>
          <span>DecisionLoop</span>
        </Link>
        <div className="flex items-center gap-5">
          <Link className="text-xs text-ink-400" href="/login">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Open workspace →
          </Link>
        </div>
      </header>
      <section className="landing-hero">
        <div>
          <p className="eyebrow">Decision memory for humans & agents</p>
          <h1>Give agents the reasoning behind your code.</h1>
          <p className="landing-description">
            A new session should inherit more than the implementation. Preserve
            the tradeoff, retrieve it before the next change, and notice when its
            assumptions stop holding.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="btn-primary">
              Enter your workspace →
            </Link>
            <Link href="/signup" className="btn-secondary">
              Create an account
            </Link>
          </div>
          <p className="mt-5 text-xs text-ink-500">Agents propose. People decide. The record stays traceable.</p>
        </div>
        <div className="landing-record">
          <div className="mb-6 flex justify-between border-b border-ink-700 pb-4">
            <p className="text-[10px] uppercase tracking-[.15em] text-ink-400">
              An example decision
            </p>
            <span className="pill bg-emerald-50 text-signal-600">Active</span>
          </div>
          <p className="record-reference">ADR-018 / AUTHENTICATION</p>
          <h2 className="mt-3 text-2xl font-semibold">
            Keep sessions revocable.
          </h2>
          <div className="mt-6 space-y-6">
            <div>
              <p className="eyebrow">Chosen</p>
              <p className="text-sm">Server-side sessions in Redis</p>
            </div>
            <div>
              <p className="eyebrow">Why</p>
              <p className="text-sm leading-7 text-ink-400">
                Customers need immediate access revocation. Stateless tokens
                would keep working after offboarding.
              </p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-950 p-4">
              <p className="eyebrow">Condition to watch</p>
              <p className="text-xs leading-6 text-ink-300">
                Immediate revocation remains a customer requirement.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-between border-t border-ink-700 pt-4 text-[10px] text-ink-400">
            <span>Choice. Reason. Condition.</span>
            <span>Preserved together ↗</span>
          </div>
        </div>
      </section>
      <section className="landing-demo" aria-labelledby="demo-title">
        <div className="landing-demo-copy">
          <h2 id="demo-title">One choice. Several agent sessions.</h2>
          <p>Watch a recorded tradeoff become context for the next task, then a
            review when new evidence challenges it.</p>
          <a href="https://github.com/Haseeb-Arshad/DecisionLoop/tree/decisionloop-2.0"
            className="text-sm font-medium text-signal-600">Explore the repository</a>
        </div>
        <video className="landing-video" controls preload="none" playsInline poster="/demo/poster.png"
          aria-label="DecisionLoop product demonstration, 36 seconds">
          <source src="/demo/decisionloop.mp4" type="video/mp4"/>
          <track kind="captions" src="/demo/decisionloop.vtt" srcLang="en" label="English"/>
          Your browser does not support embedded video. <a href="/demo/decisionloop.mp4">Download the demo.</a>
        </video>
        <p className="landing-demo-note">Local demonstration data. Animated panels illustrate the agent workflow.</p>
      </section>
      <section className="landing-features">
        {[
          [
            "01",
            "Record the tradeoff",
            "Capture the choice, rejected alternatives, and the conditions that made it reasonable.",
          ],
          [
            "02",
            "Bring the why into the next task",
            "Retrieve decision context by resources and intent before a person or agent changes the system.",
          ],
          [
            "03",
            "Notice when the reasons change",
            "Check matching observations against stored conditions. Review conflicts with the evidence alongside them.",
          ],
        ].map(([n, t, p]) => (
          <article key={n}>
            <p className="text-xs text-signal-600">{n} /</p>
            <h2 className="mt-4 text-lg font-semibold">{t}</h2>
            <p className="mt-3 text-sm leading-7 text-ink-400">{p}</p>
          </article>
        ))}
      </section>
      <footer className="landing-footer">
        <span>DecisionLoop · 2.0 alpha</span>
        <a href="https://github.com/Haseeb-Arshad/DecisionLoop/blob/decisionloop-2.0/docs/deployment.md">Local setup and deployment</a>
      </footer>
    </main>
  );
}
