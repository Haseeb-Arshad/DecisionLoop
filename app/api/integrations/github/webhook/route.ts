import { getApiHandler } from "@/lib/decisionloop";

/** GitHub App webhook: signature-verified, enqueued, processed by the worker. */
export const dynamic = "force-dynamic";

export const POST = (req: Request) => getApiHandler()(req);
