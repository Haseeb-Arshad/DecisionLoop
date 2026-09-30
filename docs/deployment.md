# Deployment and local operation

DecisionLoop has two supported runtime layouts: a single local process with an embedded database,
or a container deployment with an external database and a durable worker. The UI is a control plane;
the CLI, SDK, MCP and browser use the same decision services.

## Fresh local installation

Use Node 22 LTS and npm. From the DecisionLoop clone:

```powershell
npm ci
npm run build
npm link
```

From the repository whose decisions you want to record:

```powershell
decisionloop init
decisionloop serve --web
```

Open http://127.0.0.1:4318/signup and create the first account. It joins the CLI workspace,
so browser and agent records stay together. Subsequent local registration is closed.
The server runs the web app, API, MCP and worker over one shared embedded connection.
Stop the server before running local commands that open the database directly (init, user create).
Normal client commands such as context, propose and doctor use HTTP and work while it runs.

For UI development, use `decisionloop serve --web --dev`. This skips the production build requirement.
Plain `npm run dev` requires an external DATABASE_URL and a separate worker; it is not the embedded entry point.
The CLI and database scripts load .env.local and other Next-style environment files before starting.
Existing process environment variables take precedence.

## Container deployment

Use Docker Compose v2. Copy .env.production.example to .env.production.
Set POSTGRES_PASSWORD to a URL-safe strong random value and SESSION_SECRET to a random 32+ character secret.
Set APP_BASE_URL to the HTTPS address you will expose.

```powershell
Copy-Item .env.production.example .env.production
# Edit the two secrets and APP_BASE_URL before running this command.
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
```

The topology is explicit:

- postgres: pgvector PostgreSQL with a persistent volume and no public database port.
- migrate: one-shot resumable migrations, required before either application process starts.
- web: the built Next.js app and API; its internal worker is disabled.
- worker: the same image running the durable job loop, including GitHub handlers and assumption expiry.

Port 3000 is bound to loopback. Put an HTTPS reverse proxy in front of it. Production session cookies
are Secure. APP_BASE_URL describes the public address; it does not configure TLS.
If your proxy replaces untrusted forwarding headers, set DECISIONLOOP_TRUST_PROXY=true.
Otherwise leave it false; authentication limits use a conservative shared bucket.

Registration is closed by default. For the initial account, temporarily set
DECISIONLOOP_ALLOW_SIGNUP=true, restart the web service, create the owner through /signup,
then set it back to false and recreate the web service. Leave it closed for a private demo.

For a managed CockroachDB or PostgreSQL database, use the same image, provide its DATABASE_URL,
run `npm run db:migrate` once, then run `npm start`. The start command runs a worker by default.
To scale web and worker independently, set DECISIONLOOP_DISABLE_WORKER=true on the web processes
and run `node bin/decisionloop.mjs worker` in a separate process. Each replica shares database-backed
request budgets. Only one process may open a given embedded database directory.

`npm start` requires an external DATABASE_URL and SESSION_SECRET; it refuses silent embedded fallback.
Runtime secrets are passed at startup. They are excluded from the image build context.
The image includes the built UI, packages, migrations and tsx runtime; no nonexistent public directory is copied.

## Optional integrations

The default is no reasoning model and offline lexical embeddings. Recording decisions, typed
evidence checking, reviews and resource-based context retrieval work without a model.
Lexical retrieval is based on vocabulary, not semantic model quality.

For OpenAI-compatible models, explicitly set DECISIONLOOP_REASONING_PROVIDER=openai and
OPENAI_REASONING_MODEL; set the embedding provider separately if needed. OPENAI_BASE_URL defaults
to the official endpoint when blank. Embeddings must return 512 dimensions.
For Bedrock, select bedrock, set AWS_REGION and grant the runtime role model access.
The browser's AI endpoints follow the same provider selection as the core.

S3 document upload is optional and extraction requires a reasoning model. Set S3_BUCKET_NAME and AWS_REGION, grant private bucket access,
and configure bucket CORS for the HTTPS app origin and PUT uploads. Prefer workload roles to static keys.
When absent, the browser offers structured observations instead of a broken upload flow.

For the GitHub App, follow [the GitHub guide](v2/github-app.md). Workflow checks match exact
repository and workflow names. A configured check is not proof that a live workflow ran.

## Verification and operations

```powershell
npm run typecheck
npm run lint
npm test
npm run eval
npm run build
npm audit
```

GitHub Actions repeats the checks and builds the Docker image. A successful CI run requires pushing
the changes; adding the workflow file alone is not evidence of a hosted run.

GET /api/health checks database connectivity. The authenticated System health view shows worker
heartbeat, queue state and configured providers. A health response cannot prove model access,
document upload, GitHub delivery, or end-to-end decision processing.

Back up the database volume or managed database, test recovery, monitor failed/dead jobs in the
overview and incoming events, and inspect the oldest queued job and worker heartbeat.
Do not switch embedding providers on existing data without reindexing memory with the new provider.

The old Amplify deployment configuration has been removed: it omitted the durable worker and
was based on an older framework support assumption. Use the container topology above.

## Evidence boundary

The repository is an alpha engineering project. Automated tests cover local processing and simulated
external integrations. A real cloud environment still needs fresh validation of authentication,
persistence after restart, evidence processing, model/S3 access, and GitHub App delivery.
Docker image execution must be verified on a machine with Docker available.

The production entry point is checked after the build with `npm run verify:deployment`.
It starts an isolated SQL server, launches the actual production process, tests authentication,
model-free decisions and evidence, browser conflict resolution, context retrieval, and restart
persistence, then confirms hosted registration is closed. It never opens the configured database.
