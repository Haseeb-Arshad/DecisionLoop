# DecisionLoop — Deployment

From an empty AWS account and a fresh CockroachDB cluster to a running deployment, plus how
to run each tier of the test suite.

## 1. Prerequisites

| Service | What you need | Notes |
|---|---|---|
| CockroachDB Cloud | A cluster (Basic/Serverless is fine) | v25.2+ gets the C-SPANN vector index; older versions still work (see §3) |
| AWS account | IAM credentials or a role | Used for S3, Bedrock, and hosting |
| Amazon Bedrock | **Model access enabled** for the reasoning and embedding models | This is opt-in per account *and* per region — an IAM key alone does not grant it |
| S3 | A private bucket | Never make it public |
| CockroachDB MCP *(optional)* | Service-account API key with `mcp:read` | The Memory Inspector degrades gracefully without it |

## 2. Enable Bedrock model access

The single most common first-run failure. In the AWS console:

1. Go to **Bedrock → Model access** in the region you'll deploy to.
2. Request access to **Anthropic Claude** (the model in `BEDROCK_REASONING_MODEL_ID`, default
   `us.anthropic.claude-sonnet-4-5-20250929-v1:0`) and **Amazon Titan Text Embeddings V2**.
3. Wait for status **Access granted**.

Two notes:

- Newer Claude models on Bedrock require a **cross-region inference profile ID** (the
  `us.`-prefixed form) rather than the bare model ID for on-demand invocation. The default in
  `.env.example` is already in that form. Using the bare ID returns *"on-demand throughput
  isn't supported"*.
- Model availability differs by region. If your chosen model isn't listed, either switch
  region or set `BEDROCK_REASONING_MODEL_ID` to one that is available to you.

Verify from the CLI before deploying:

```bash
aws bedrock list-foundation-models --region us-east-1 --query "modelSummaries[?contains(modelId,'claude')].modelId"
```

## 3. Create the CockroachDB cluster

1. Create a cluster in CockroachDB Cloud.
2. Create a SQL user and copy the **connection string** (Connect → Connection string). It
   already includes `sslmode=verify-full` and, for Serverless, the `options=--cluster=...`
   parameter — keep both.
3. Set it as `DATABASE_URL`.

**Vector index:** `db/migrations/0002_vector_index.optional.sql` creates a C-SPANN vector
index and requires CockroachDB v25.2+. The migration runner treats it as optional: if the
cluster doesn't support `CREATE VECTOR INDEX`, it logs a warning, marks it applied, and the
app falls back to a brute-force `ORDER BY embedding <=> $1` scan. Identical results, slower at
scale. You'll see `skip*` in the migration output if this happened.

## 4. Create the S3 bucket

```bash
aws s3api create-bucket --bucket decisionloop-documents --region us-east-1
aws s3api put-public-access-block --bucket decisionloop-documents \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

CORS is required because the browser PUTs directly to S3 via a presigned URL:

```bash
aws s3api put-bucket-cors --bucket decisionloop-documents --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["https://your-app-domain"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}'
```

Replace `AllowedOrigins` with your real domain — `*` would let any site upload using a
presigned URL leaked from your app.

## 5. IAM permissions

Minimum policy for the app's role or user:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::decisionloop-documents/*"
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:*:*:inference-profile/*"
      ]
    }
  ]
}
```

The inference-profile ARN is required alongside the foundation-model ARN — invoking through a
cross-region profile checks both.

## 6. Deploy — AWS Amplify Hosting (primary path)

1. Amplify console → **New app → Host web app** → connect the GitHub repository, branch
   `main`. Amplify detects Next.js and picks up [`amplify.yml`](../amplify.yml).
2. Set every environment variable from [`.env.example`](../.env.example) under **App settings
   → Environment variables**.
3. Deploy.

`amplify.yml` runs `npm run db:migrate` before `npm run build` on every deploy. Migrations are
tracked in `schema_migrations` and applied at most once, so this is safe to repeat.

**Prefer a service role over static keys.** Attach the IAM policy above to the Amplify service
role and omit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` entirely — both `lib/aws/s3.ts`
and `lib/ai/bedrock.ts` fall through to the default AWS credential provider chain.

### Fallback: any container host

[`Dockerfile`](../Dockerfile) builds a self-contained Next.js standalone image for App Runner,
ECS, or anything else:

```bash
docker build -t decisionloop .
docker run -p 3000:3000 --env-file .env.local decisionloop
```

Migrations aren't run by the image — run `npm run db:migrate` as a separate step or an ECS
task before rolling out.

## 7. Seed the demo

```bash
npm run db:seed
```

This runs the Northstar Commerce scenario end-to-end **through the real pipeline** — it
extracts a decision from the three vendor documents via Bedrock, commits it, then ingests the
2027 pricing notice in a separate session and lets conflict detection find the contradiction
on its own. Expect it to take a minute or two and to print the decision URL at the end.

Credentials: `maya.chen@northstar.example` / `decisionloop-demo`.

To start over: `npm run db:reset-demo -- --yes`, then seed again.

## 8. Verify the deployment

```bash
curl https://your-app/api/health
npm run verify:memory
```

`verify:memory` checks the things §71 says must be true before claiming the system works: the
schema is the full model, `memory_chunks.embedding` is a native `VECTOR` column, a real
embedding provider is in use (not the local fallback), vector retrieval returns scored rows,
at-risk decisions are backed by real conflict rows and traces, and cross-session recall has
actually occurred. It exits non-zero on failure.

## 9. Running the tests

```bash
npm run test:unit          # no infrastructure needed
npm run test:integration   # requires DATABASE_URL; skips itself without one
npm run test:e2e           # requires E2E_BASE_URL; skips itself without one
npm test                   # unit + integration
```

**Integration** tests create and delete their own throwaway tenants. Point `DATABASE_URL` at a
non-production cluster.

**E2E** runs Playwright against a *deployed* URL — §61 is explicit that localhost success is
not deployment success:

```bash
npx playwright install chromium
E2E_BASE_URL=https://your-app npm run test:e2e
```

It drives the full two-session story in separate browser contexts, so a pass proves the memory
survived a session boundary through CockroachDB rather than client state.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `on-demand throughput isn't supported` | Bare model ID used where an inference profile is required | Use the `us.`-prefixed profile ID |
| `AccessDeniedException` from Bedrock | Model access not granted in that region | Bedrock → Model access; check the region matches `AWS_REGION` |
| Seed finds no conflicts | Local hash-embedding fallback in use — it has no semantic meaning | Set `AWS_REGION` and enable Titan Embeddings access |
| `CREATE VECTOR INDEX` warning in migrations | CockroachDB below v25.2 | Harmless; brute-force scan is used. Upgrade for ANN performance. |
| S3 upload fails in the browser with a CORS error | Bucket CORS missing your origin | Add it to `AllowedOrigins` |
| `SESSION_SECRET is not set` | Missing env var | Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| Migration fails mid-file | A schema change conflicted | The runner applies statements one at a time; fix the failing statement and re-run — applied migrations are skipped |
