import { getApiHandler } from "@/lib/decisionloop";

/**
 * DecisionLoop v1 API (agents, SDK, CLI, and the control plane itself).
 * All routing and logic live in @decisionloop/api and @decisionloop/core;
 * this file only mounts the Fetch-standard handler.
 */
export const dynamic = "force-dynamic";

const handle = (req: Request) => getApiHandler()(req);

export { handle as GET, handle as POST };
