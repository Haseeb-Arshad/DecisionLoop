import Link from "next/link";

const FEATURES = [
  {
    title: "Assumption-aware memory",
    description:
      "Committing a decision doesn't save a paragraph of prose — it saves the options considered, the reasoning, and the concrete, checkable assumptions it depends on, as structured rows in CockroachDB.",
  },
  {
    title: "Automatic invalidation",
    description:
      "Upload a new document in a brand new session, with no reference to any prior decision. DecisionLoop independently recalls the decision it relates to and checks whether the new facts still hold.",
  },
  {
    title: "Memory Inspector",
    description:
      "Every AI action that touches memory writes its own trace: the SQL that ran, the similarity scores, the rows used — plus an independent cross-check via CockroachDB's own Managed MCP Server.",
  },
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_-10%,rgba(18,163,127,0.18),transparent)]"
      />
      <div className="relative mx-auto flex max-w-5xl flex-col px-6 py-20">
        <header className="mb-24 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-signal-500 text-sm font-bold text-ink-950">
              D
            </div>
            <span className="text-sm font-semibold tracking-tight">DecisionLoop</span>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-ink-300 hover:text-ink-100">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary !px-3 !py-1.5">
              Get started
            </Link>
          </nav>
        </header>

        <div className="animate-fade-in max-w-3xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-signal-400">
            Assumption-aware decision memory
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink-50 sm:text-5xl">
            Remember why a decision was made.
            <br />
            <span className="text-ink-300">Notice the moment it stops being true.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-300">
            DecisionLoop persists the reasoning and the checkable assumptions behind every
            decision your team makes — then watches new evidence, in entirely new sessions, for
            the moment one of those assumptions quietly stops holding.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link href="/signup" className="btn-primary">
              Start a workspace
            </Link>
            <Link href="/login" className="btn-secondary">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-5 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card animate-fade-in p-5">
              <h3 className="mb-2 text-sm font-semibold text-ink-100">{f.title}</h3>
              <p className="text-sm leading-relaxed text-ink-300">{f.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 card p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            The scenario this is built around
          </p>
          <ol className="space-y-2 text-sm leading-relaxed text-ink-300">
            <li>
              <span className="font-medium text-ink-100">Session 1 —</span> a team picks
              SignalForge over MetricLake, on the assumption pricing stays under $25,000/year.
              They commit the decision.
            </li>
            <li>
              <span className="font-medium text-ink-100">Weeks later, session 2 —</span> someone
              uploads SignalForge&apos;s new pricing sheet: $42,000/year. They don&apos;t mention
              the earlier decision.
            </li>
            <li>
              <span className="font-medium text-ink-100">DecisionLoop —</span> independently
              recalls the decision, flags the assumption as invalidated, marks it{" "}
              <span className="text-risk-400">AT RISK</span>, and shows exactly which CockroachDB
              rows drove that conclusion.
            </li>
          </ol>
        </div>

        <footer className="mt-20 text-xs text-ink-500">
          Built on CockroachDB (structured data + native vector search), Claude, and AWS.
        </footer>
      </div>
    </main>
  );
}
