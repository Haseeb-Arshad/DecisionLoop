# GitHub App (advisory PR checks)

When a pull request touches code governed by a recorded decision, DecisionLoop comments with the
decision, why it was made, what the PR changes, and which recorded assumptions nothing in the PR
addresses. It is **advisory only** — it never blocks a merge. Each finding carries an id so a false
positive can be dismissed in the control plane and counted.

Merged PRs are evidence (authority 0.8) and can invalidate assumptions; open PRs (0.5) cannot change
memory.

## 1. Create the App

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.

- **Webhook URL:** `https://<your DecisionLoop host>/api/integrations/github/webhook`
- **Webhook secret:** a random string → `GITHUB_WEBHOOK_SECRET`
- **Repository permissions (minimum):** Pull requests: *Read*; Contents: *Read*; Actions: *Read*;
  Issues: *Read & write* (to post the advisory comment); Metadata: *Read*.
- **Subscribe to events:** Pull request, Push, Release, Workflow run, Issues.

Generate a private key → `GITHUB_APP_PRIVATE_KEY` (PEM; `\n`-escaped is accepted) and note the App ID →
`GITHUB_APP_ID`. For local development only, `GITHUB_TOKEN` (a personal access token) can replace App
auth.

## 2. Bind repositories to a workspace

`decisionloop init` binds the current repository automatically (from `git remote origin`). Deliveries for
repositories that are not bound are acknowledged and ignored.

## 3. Run a worker

The webhook route only verifies the signature, routes to a workspace and enqueues a job (it answers in
milliseconds and GitHub redeliveries are no-ops). A worker fetches the PR's files and `package.json`
diffs, evaluates them, and posts or edits one comment per PR. `decisionloop serve` includes a worker; with
a separate web deployment run `decisionloop worker` (needs `DATABASE_URL`).

## Security

- Signatures (`X-Hub-Signature-256`) are verified on the raw body with a constant-time comparison before
  anything is parsed.
- PR titles, bodies and comments are untrusted evidence. They are never treated as instructions, and no
  webhook path can commit, approve or dismiss anything.
- The App's installation token is requested per installation and cached until shortly before expiry.

## Decision verification receipts

A decision can list the exact GitHub Actions workflow name and repository whose runs provide
verification evidence:

```json
{
  "verificationChecks": [
    {
      "name": "Authentication integration tests",
      "repository": "acme/product",
      "kind": "TEST",
      "description": "Covers session revocation after account offboarding"
    }
  ]
}
```

`name` must exactly match the workflow's `name:` value in a completed `workflow_run` payload.
DecisionLoop stores each matching run's conclusion, commit SHA, completion time and details URL.
Coding agents receive the latest receipt with decision context, including when no run has been
recorded. A receipt applies only to its recorded commit; DecisionLoop does not claim that an
unseen or different commit passed. Receipts are evidence for review and do not block merges or
change decision status automatically.

## Verified so far

Tested against a fake GitHub API (signature rejection, redelivery idempotency, one comment edited in place
across pushes, enrichment from PR files and manifests). The workflow receipt path is covered against the
embedded database for exact matching, re-runs, failure conclusions, tenant isolation, agent context and
human-only configuration. Not yet exercised against a live App installation or a hosted database.
