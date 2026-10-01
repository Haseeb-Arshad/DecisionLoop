import Link from "next/link";
import { HeroLoop } from "@/components/HeroLoop";

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

        <div className="mt-8">
          <HeroLoop
            src="/demo/the-line-on-the-wall-loop.mp4"
            poster="/demo/the-line-on-the-wall.png"
            label="A flood study invalidates the assumption behind four decisions; DecisionLoop flags them and tells an agent to stop. 25-second silent loop."
          />
          <p className="landing-demo-note">
            A fictional city. The screens are the real product. <a className="underline" href="#film">Watch the full film</a>.
          </p>
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

      <section id="film" className="landing-demo" aria-labelledby="demo-title">
        <div className="landing-demo-copy">
          <h2 id="demo-title">The line on the wall</h2>
          <p>
            A city decides where to build a school, where to keep a hospital&apos;s generators and how to evacuate, all on one assumption about a
            river. Years later the assumption stops being true. 1 min 43 s, with sound and captions.
          </p>
        </div>
        <video className="landing-video" controls preload="none" playsInline poster="/demo/the-line-on-the-wall.png" aria-label="The line on the wall: DecisionLoop explained, 1 minute 43 seconds">
          <source src="/demo/the-line-on-the-wall.mp4" type="video/mp4" />
          <track kind="captions" src="/demo/the-line-on-the-wall.vtt" srcLang="en" label="English" default />
          Your browser does not support embedded video. <a href="/demo/the-line-on-the-wall.mp4">Download the film.</a>
        </video>
        <p className="landing-demo-note">
          Riverton is fictional; every value on screen comes from the real engine running that scenario.{" "}
          <a className="underline" href="/demo/the-line-on-the-wall-720p.mp4">720p version</a> ·{" "}
          <a className="underline" href="/demo/decisionloop.mp4">the earlier 36-second film</a>
        </p>
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
