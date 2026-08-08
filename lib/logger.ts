import pino from "pino";

/**
 * Structured JSON logging. In production this is what Amplify/CloudWatch
 * captures; every mutating action also gets a matching row in `audit_events`
 * (lib/repo/auditEvents.ts) — logs are for operators, audit_events are for
 * "what happened to this tenant's data," and the two are deliberately not
 * the same mechanism.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "decisionloop" },
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
