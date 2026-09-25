import { getApiHandler } from "@/lib/decisionloop";

/** Remote MCP endpoint (streamable HTTP, stateless). Requires an API key. */
export const dynamic = "force-dynamic";

const handle = (req: Request) => getApiHandler()(req);

export { handle as GET, handle as POST, handle as DELETE };
