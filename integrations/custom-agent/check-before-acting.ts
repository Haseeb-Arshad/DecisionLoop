import { DecisionLoop } from "@decisionloop/sdk";

/**
 * A custom agent (any language model, any framework) that checks standing
 * decisions before an action with side effects. Run it against a server that
 * was started with `decisionloop init --profile support`.
 *
 *   DECISIONLOOP_URL=http://127.0.0.1:4318 DECISIONLOOP_API_KEY=<agent key> npx tsx integrations/custom-agent/check-before-acting.ts
 *
 * Only the agent key is needed: it can read, check and propose, and can never
 * make a decision authoritative.
 */
const dl = new DecisionLoop({ agent: { name: "refund-bot", sessionId: `run-${Date.now()}` } });

export async function refund(orderId: string, amountUsd: number): Promise<string> {
  const check = await dl.actions.check({
    action: `Refund order ${orderId} for $${amountUsd}`,
    resources: ["policy:refunds"],
    facts: [
      {
        predicate: "refund_amount_usd",
        valueType: "NUMBER",
        value: amountUsd,
        unit: "USD",
        statement: `Refund of $${amountUsd}`,
      },
    ],
  });

  if (check.verdict === "stop") return `Not refunded. A person must approve it.\n${check.summary}`;
  if (check.verdict === "caution") return `Hold and ask a person first.\n${check.summary}`;
  // "clear" or "no_decision": proceed with your own refund logic here.
  return `Refunded $${amountUsd} on ${orderId}.`;
}

if (process.argv[1]?.endsWith("check-before-acting.ts")) {
  refund("1234", Number(process.argv[2] ?? 350)).then((m) => process.stdout.write(`${m}\n`));
}
