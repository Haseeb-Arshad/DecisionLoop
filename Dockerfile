# Portable fallback deployment target (AWS App Runner / ECS / any container
# host) — the primary deployment path is AWS Amplify Hosting building
# directly from the GitHub repo (see amplify.yml and docs/architecture.md
# §8), which needs no Dockerfile. This exists so the app isn't locked to
# Amplify specifically.
FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env vars are never baked into the image with real values here —
# they're placeholders so `next build` doesn't fail on a missing-credential
# throw at module load time (db/client.ts, lib/ai/anthropic.ts, etc. all read
# their real env vars lazily, at request time, from the container's actual
# runtime environment — see docs/architecture.md §8).
ENV SESSION_SECRET=build-only-placeholder
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
