import { sql } from "@/db/client";
import { takeRequestLimit } from "@decisionloop/runtime/requestLimits";

export class RequestLimitError extends Error {
  constructor() {
    super("Too many requests. Please wait before trying again.");
    this.name = "RequestLimitError";
  }
}
export async function consumeLimit(
  key: string,
  limit: number,
  seconds = 60,
): Promise<void> {
  if (!(await takeRequestLimit(sql, key, limit, seconds)))
    throw new RequestLimitError();
}
export async function limitAuthentication(
  req: Request,
  action: string,
): Promise<void> {
  const ip =
    process.env.DECISIONLOOP_TRUST_PROXY === "true"
      ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      : "direct";
  await consumeLimit(
    `auth:${action}:${ip}`,
    action === "signup" ? 10 : 30,
    600,
  );
}
export async function limitCost(
  tenantId: string,
  action: string,
): Promise<void> {
  await consumeLimit(
    `cost:${tenantId}:${action}`,
    action === "upload" ? 30 : 20,
    3600,
  );
}
