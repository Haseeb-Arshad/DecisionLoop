# One image for the web app, durable worker, CLI and explicit migrations.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOST=0.0.0.0
# tsx and runtime dependencies are needed by the shared TypeScript services.
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npm", "start"]
