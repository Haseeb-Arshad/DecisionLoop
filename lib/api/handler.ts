import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthenticatedError } from "@/lib/auth/currentUser";
import { BedrockRefusalError } from "@/lib/ai/bedrock";
import { childLogger } from "@/lib/logger";
import { DecisionLoopError } from "@decisionloop/core/errors";
import { RequestLimitError } from "./limits";

const log = childLogger({ module: "api" });

export function jsonError(
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ error: message, details }, { status });
}

/** Central error → HTTP mapping for route handlers. Wrap the body of every
 * route handler's try/catch in this so failure modes are consistent. */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof RequestLimitError) return jsonError(err.message, 429);
  if (err instanceof DecisionLoopError) {
    const status = { not_found: 404, forbidden: 403, invalid: 400, conflict: 409, approval_required: 202, unavailable: 503 };
    return jsonError(err.message, status[err.code]);
  }
  if (err instanceof UnauthenticatedError) {
    return jsonError("Authentication required.", 401);
  }
  if (err instanceof ZodError) {
    return jsonError("Invalid request.", 400, err.flatten());
  }
  if (err instanceof BedrockRefusalError) {
    return jsonError(
      "The AI declined to process this request.",
      422,
      err.stopDetails,
    );
  }
  log.error({ err }, "unhandled API error");
  return jsonError("The request could not be completed. Please try again.", 500);
}
