import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthenticatedError } from "@/lib/auth/currentUser";
import { ClaudeRefusalError } from "@/lib/ai/anthropic";
import { childLogger } from "@/lib/logger";

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
  if (err instanceof UnauthenticatedError) {
    return jsonError("Authentication required.", 401);
  }
  if (err instanceof ZodError) {
    return jsonError("Invalid request.", 400, err.flatten());
  }
  if (err instanceof ClaudeRefusalError) {
    return jsonError(
      "The AI declined to process this request.",
      422,
      err.stopDetails,
    );
  }
  log.error({ err }, "unhandled API error");
  const message = err instanceof Error ? err.message : "Internal server error";
  return jsonError(message, 500);
}
