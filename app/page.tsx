import Link from "next/link";

const REPO = "https://github.com/Haseeb-Arshad/DecisionLoop";

export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link className="brand" href="/">
          DecisionLoop
        </Link>
        <nav className="flex items-center gap-5 text-sm" aria-label="Site">
          <a className="underline" href={REPO}>
            GitHub
          </a>
          <Link className="underline" href="/login">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Open workspace
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <h1>Decision memory for people and the agents that work for them.</h1>
        <p className="landing-description">
          DecisionLoop records why something was decided: the choice, the alternatives that were rejected, and the assumptions that made it
          reasonable. Before an agent acts, it can ask what governs the work. When new evidence contradicts an assumption, the decision is flagged
          for a person to review.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-primary">
            Create an account
          </Link>
          <a href={`${REPO}#readme`} className="btn-secondary">
            Read the README
          </a>
        </div>

        <div className="landing-record" aria-label="Example decision">
          <p className="record-reference">SUP-007 / support policy</p>
          <h2 className="mt-1 text-base">Auto-approve refunds up to $200</h2>
          <dl className="kv mt-3">
            <dt>Why</dt>
            <dd>Consumer chargebacks are rare, so small refunds are cheaper to grant than to review.</dd>
            <dt>Rejected</dt>
            <dd>Escalating every refund to a person: resolution time tripled.</dd>
            <dt>Assumes</dt>
            <dd>Consumer chargeback rate stays under 0.5%.</dd>
            <dt>Evidence</dt>
            <dd className="text-risk-600">Finance reports 1.2% for September. The decision is marked at risk.</dd>
          </dl>
        </div>
      </section>

      <section className="landing-features" aria-label="How it works">
        {[
          ["Record", "Capture the choice, the rejected alternatives and the conditions. People commit decisions; agents can only propose them."],
          ["Ask before acting", "An agent asks what governs the files, customers, vendors or policies it is about to touch, and gets a short, sourced answer."],
          ["Notice change", "Numbers, dates, versions and yes/no facts are compared by code. A model is used only for statements code cannot judge."],
        ].map(([title, body]) => (
          <article key={title}>
            <h2 className="text-base">{title}</h2>
            <p className="mt-1 text-sm text-ink-300">{body}</p>
          </article>
        ))}
      </section>

      <section className="landing-demo" aria-labelledby="demo-title">
        <div className="landing-demo-copy">
          <h2 id="demo-title">Demo film</h2>
          <p>One decision carried across several agent sessions, then reviewed when evidence changed. 36 seconds.</p>
        </div>
        <video className="landing-video" controls preload="none" playsInline poster="/demo/poster.png" aria-label="DecisionLoop demonstration, 36 seconds">
          <source src="/demo/decisionloop.mp4" type="video/mp4" />
          <track kind="captions" src="/demo/decisionloop.vtt" srcLang="en" label="English" />
          Your browser does not support embedded video. <a href="/demo/decisionloop.mp4">Download the demo.</a>
        </video>
        <p className="landing-demo-note">Synthetic demonstration data.</p>
      </section>

      <footer className="landing-footer">
        <span>DecisionLoop, 2.0 alpha. MIT licensed.</span>
        <a className="underline" href={`${REPO}/blob/main/docs/deployment.md`}>
          Setup and deployment
        </a>
      </footer>
    </main>
  );
}
