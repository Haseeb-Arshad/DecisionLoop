import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEvaluationOutcome, type OutcomeInput } from "@decisionloop/core/lifecycle/outcome";
import { DEFAULT_POLICIES, evaluatePolicies, mergePolicies, policyRuleSchema } from "@decisionloop/core/policy/policy";
import { globToRegExp, parseResource, resourceMatchScore } from "@decisionloop/core/resources/resources";
import { inboundEventSchema } from "@decisionloop/core/events/event";

function outcome(overrides: Partial<OutcomeInput> = {}) {
  return resolveEvaluationOutcome({
    relation: "CONTRADICTS",
    confidence: 1,
    method: "DETERMINISTIC",
    evidenceAuthority: 0.85,
    assumptionAuthority: 0.8,
    assumptionImportance: 0.7,
    currentValidity: "VALID",
    decisionImportance: 0.6,
    source: "api",
    actorType: "user",
    affectedResourceTypes: [],
    domain: "engineering",
    policies: DEFAULT_POLICIES,
    ...overrides,
  });
}

describe("evaluation outcome = severity rules + policies", () => {
  it("authoritative, confident contradiction invalidates and flags the decision", () => {
    expect(outcome()).toMatchObject({ recordConflict: true, nextValidity: "INVALIDATED", flagDecision: true, requireReview: false });
  });

  it("G: high-authority evidence invalidates; F: low-authority evidence only challenges", () => {
    expect(outcome({ evidenceAuthority: 0.95 }).nextValidity).toBe("INVALIDATED");
    const weak = outcome({ evidenceAuthority: 0.3, assumptionAuthority: 0.3 });
    // Severity alone would invalidate (authority is comparable); the
    // low_authority_evidence policy caps it.
    expect(weak.nextValidity).toBe("CHALLENGED");
    expect(weak.matchedRules).toContain("low_authority_evidence");
  });

  it("an agent's own evidence can challenge but not invalidate", () => {
    const r = outcome({ actorType: "agent", evidenceAuthority: 0.9 });
    expect(r.nextValidity).toBe("CHALLENGED");
    expect(r.matchedRules).toContain("agent_supplied_evidence");
  });

  it("invalidating an important decision's assumption requires review and notifies", () => {
    const r = outcome({ decisionImportance: 0.9 });
    expect(r).toMatchObject({ nextValidity: "INVALIDATED", requireReview: true });
    expect(r.notify).toEqual(["dashboard", "github"]);
  });

  it("C: supporting evidence is recorded as support and changes nothing", () => {
    expect(outcome({ relation: "SUPPORTS" })).toMatchObject({ recordSupport: true, recordConflict: false, nextValidity: null });
  });

  it("never moves an assumption backwards", () => {
    const r = outcome({ currentValidity: "INVALIDATED", evidenceAuthority: 0.3 });
    expect(r.recordConflict).toBe(true);
    expect(r.nextValidity).toBeNull();
  });

  it("H: superseded decisions' assumptions are history only", () => {
    expect(outcome({ currentValidity: "SUPERSEDED" })).toMatchObject({ recordConflict: false, nextValidity: null });
  });

  it("a workspace policy can make things stricter, e.g. suppress a noisy source", () => {
    const rules = mergePolicies(DEFAULT_POLICIES, [
      policyRuleSchema.parse({ scope: "evaluation", name: "mute_news", when: { source: ["news"] }, actions: ["suppress"] }),
    ]);
    expect(outcome({ source: "news", policies: rules })).toMatchObject({ recordConflict: false, nextValidity: null });
  });

  it("commit policy: agents propose, humans commit", () => {
    expect(evaluatePolicies("commit", DEFAULT_POLICIES, { actorType: "agent" }).actions).toContain("require_approval");
    expect(evaluatePolicies("commit", DEFAULT_POLICIES, { actorType: "user" }).actions).toEqual([]);
  });

  it("rejects malformed policy definitions", () => {
    expect(policyRuleSchema.safeParse({ scope: "evaluation", name: "x", when: { evidenceAuthority: "low" }, actions: ["suppress"] }).success).toBe(false);
    expect(policyRuleSchema.safeParse({ scope: "evaluation", name: "x", when: {}, actions: ["delete_everything"] }).success).toBe(false);
  });
});

describe("resources", () => {
  it("parses agent shorthand", () => {
    expect(parseResource("src/auth/**", "acme/app")).toEqual({ type: "path", key: "src/auth/**", repository: "acme/app" });
    expect(parseResource("npm:Redis")).toEqual({ type: "package", key: "npm:redis", repository: null });
    expect(parseResource("service:Auth")).toEqual({ type: "service", key: "auth", repository: null });
    expect(parseResource("./src\\x.ts")).toMatchObject({ key: "src/x.ts" });
  });

  it("globs", () => {
    expect(globToRegExp("src/auth/**").test("src/auth/session/redis.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("scores structural matches and respects repository scope", () => {
    const rec = parseResource("src/auth/**", "acme/app");
    expect(resourceMatchScore(rec, parseResource("src/auth/session.ts", "acme/app"))).toBe(0.9);
    expect(resourceMatchScore(rec, parseResource("src/**", "acme/app"))).toBe(0.7);
    expect(resourceMatchScore(rec, parseResource("src/billing/x.ts", "acme/app"))).toBe(0);
    expect(resourceMatchScore(rec, parseResource("src/auth/session.ts", "other/repo"))).toBe(0);
    expect(resourceMatchScore(parseResource("npm:redis"), parseResource("npm:redis"))).toBe(1);
    expect(resourceMatchScore(parseResource("npm:redis"), parseResource("src/redis.ts"))).toBe(0);
  });
});

describe("canonical event", () => {
  it("requires provenance and bounded text", () => {
    const ok = inboundEventSchema.safeParse({
      source: "github",
      externalId: "delivery-1",
      type: "pull_request.merged",
      occurredAt: new Date().toISOString(),
      actor: { type: "integration", label: "github" },
      provenance: { receivedVia: "webhook", signatureVerified: true },
    });
    expect(ok.success).toBe(true);
    expect(inboundEventSchema.safeParse({ source: "x", externalId: "1", type: "t", occurredAt: new Date().toISOString(), actor: { type: "user" } }).success).toBe(false);
  });
});

describe("core package boundary", () => {
  it("core imports no framework, database, provider SDK or app code", () => {
    const root = path.join(process.cwd(), "packages", "core", "src");
    const forbidden = /from\s+["'](next|next\/.*|react|react-dom|postgres|@aws-sdk\/.*|@electric-sql\/.*|@\/.*|@decisionloop\/(?!core).*)["']/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && forbidden.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
