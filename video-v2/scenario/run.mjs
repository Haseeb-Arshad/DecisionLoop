// Runs the film's scenario through a live DecisionLoop server and saves what
// the engine actually said, so every value and sentence in the film is real
// engine output on this (fictional) data. Nothing here is hand-written text
// about outcomes.
//
//   node run.mjs <workspace-dir> <base-url> <hydrology-key> <forum-key>
import fs from "node:fs";
import path from "node:path";

const [dir, base, hydrologyKey, forumKey] = process.argv.slice(2);
const creds = JSON.parse(fs.readFileSync(path.join(dir, ".decisionloop", "credentials.json"), "utf8"));
const api = `${base}/api/v1`;

async function call(key, method, route, body, headers = {}) {
  const res = await fetch(`${api}${route}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(eventId) {
  for (let i = 0; i < 60; i++) {
    const e = await call(creds.apiKey, "GET", `/events/${eventId}/detail`);
    if (e.event.status === "PROCESSED" || e.event.status === "FAILED") return e;
    await sleep(500);
  }
  throw new Error(`event ${eventId} did not finish`);
}

const out = { decisions: [], before: null, rumor: null, study: null, check: null, atRisk: null, reviews: null };

// 2019: four teams record four decisions on one shared assumption.
for (const d of JSON.parse(fs.readFileSync(new URL("./decisions.json", import.meta.url), "utf8"))) {
  const created = await call(creds.apiKey, "POST", "/decisions?mode=commit", d);
  out.decisions.push({ id: created.id, ref: created.externalRef, title: created.title, tag: d.tags[0] });
}

// Before anything changes, the permit agent asks what governs the east bank.
const agentHeaders = { "x-decisionloop-agent": "permit-agent", "x-decisionloop-session": "permits-2026-09" };
out.before = await call(creds.agentKey, "POST", "/context", { intent: "Review a residential permit application on the east bank", resources: ["zone:east_bank"] }, agentHeaders);

// A forum post claims the flood line is higher. Weak source: it can only challenge.
const rumor = await call(forumKey, "POST", "/events", {
  type: "post.published",
  externalId: "forum-thread-8812",
  text: "Someone on the residents' forum says the river will reach 2.9 m in a big flood now.",
  payload: { metrics: [{ subject: "river:east_bank", metric: "flood_level_100yr_m", value: 2.9, unit: "m", statement: "A forum post claims the 100-year flood reaches 2.9 m" }] },
});
out.rumor = await settle(rumor.eventId);

// The national hydrology agency publishes a new study. Strong source.
const study = await call(hydrologyKey, "POST", "/events", {
  type: "study.published",
  externalId: "national-flood-study-2026",
  text: "National Flood Study 2026: updated rainfall records put the 100-year flood level for the Riverton east bank at 3.1 m.",
  sourceRef: "https://example.test/national-flood-study-2026",
  payload: { metrics: [{ subject: "river:east_bank", metric: "flood_level_100yr_m", value: 3.1, unit: "m", statement: "The 100-year flood level for the east bank is now 3.1 m" }] },
});
out.study = await settle(study.eventId);

// A permit application for a care home arrives. The agent checks before acting.
out.check = await call(
  creds.agentKey,
  "POST",
  "/actions/check",
  {
    action: "Approve a permit for a 60-bed care home at 12 Quay Road, east bank",
    resources: ["zone:east_bank"],
    facts: [{ predicate: "vulnerable_use", valueType: "BOOLEAN", value: true, statement: "A care home is a vulnerable use" }],
  },
  agentHeaders,
);

out.atRisk = await call(creds.apiKey, "GET", "/at-risk");
out.reviews = await call(creds.apiKey, "GET", "/approvals");

const file = new URL("./output.json", import.meta.url);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const brief = (e) => e.evaluations.map((v) => `${v.method} ${v.relation} ${v.previousValidity}→${v.nextValidity} (authority ${v.evidenceAuthority})`);
console.log("decisions:", out.decisions.map((d) => d.ref).join(", "));
console.log("rumor:", out.rumor.event.source, brief(out.rumor));
console.log("study:", out.study.event.source, brief(out.study));
console.log("at risk:", out.atRisk.map((r) => r.decision.externalRef).join(", "));
console.log("reviews:", out.reviews.length);
console.log("check:", out.check.verdict);
console.log(out.check.summary.split("\n").slice(0, 4).join("\n"));
