import { factSchema, type Fact } from "../assumptions/facts";
import { normalizeKey } from "../assumptions/model";
import type { InboundEvent } from "../events/event";
import { globToRegExp, normalizePath, type ResourceRef } from "../resources/resources";
import type { ConstraintCheck, DomainPack } from "./pack";

/**
 * Engineering domain pack (docs/v2/00-audit-and-plan.md §10) — the first
 * vertical, because it can be dogfooded immediately.
 *
 * Source payloads are normalized by integrations (see packages/github)
 * into this shape before they reach the engine:
 *
 *   payload.repository        "acme/app"
 *   payload.changedFiles      [{ path, status: added|modified|removed|renamed, previousPath? }]
 *   payload.dependencyChanges [{ ecosystem, name, change: added|removed|changed, from?, to?, manifest? }]
 *   payload.ci                { workflow, conclusion }
 */

export const PACKAGE_ECOSYSTEMS = ["npm", "pypi", "go", "cargo", "maven", "gem", "nuget", "composer"] as const;

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  previousPath?: string | null;
}

export interface DependencyChange {
  ecosystem: string;
  name: string;
  change: "added" | "removed" | "changed";
  from?: string | null;
  to?: string | null;
  manifest?: string | null;
}

/** `npm:redis`, `package:npm:redis`, `package:redis` (assumed npm) all become `package:npm:redis`. */
export function canonicalPackageSubject(normalized: string): string {
  const eco = (PACKAGE_ECOSYSTEMS as readonly string[]).find((e) => normalized.startsWith(`${e}:`));
  if (eco) return `package:${normalized}`;
  if (normalized.startsWith("package:")) {
    const rest = normalized.slice("package:".length);
    const hasEco = (PACKAGE_ECOSYSTEMS as readonly string[]).some((e) => rest.startsWith(`${e}:`));
    return hasEco ? normalized : `package:npm:${rest}`;
  }
  return normalized;
}

function packageSubject(ecosystem: string, name: string): string {
  return `package:${ecosystem.toLowerCase()}:${name.toLowerCase()}`;
}

const AUTHORITY: Array<{ match: (e: InboundEvent) => boolean; authority: number }> = [
  // What merged code does is a strong fact about the system.
  { match: (e) => e.source === "github" && e.type === "pull_request.merged", authority: 0.8 },
  // An open PR is a proposal, not yet a fact.
  { match: (e) => e.source === "github" && /^pull_request\.(opened|synchronize|reopened|edited)$/.test(e.type), authority: 0.5 },
  { match: (e) => e.source === "github" && e.type.startsWith("push"), authority: 0.75 },
  { match: (e) => e.source === "github" && e.type.startsWith("release"), authority: 0.85 },
  { match: (e) => e.source === "github" && e.type.startsWith("workflow_run"), authority: 0.8 },
  { match: (e) => e.source === "github" && /^(issues|issue_comment)/.test(e.type), authority: 0.3 },
  { match: (e) => e.source === "ci", authority: 0.8 },
  { match: (e) => e.source === "metrics", authority: 0.85 },
];

function extractEngineering(event: InboundEvent): { facts: Fact[]; resources: ResourceRef[] } {
  const payload = event.payload as {
    repository?: string;
    changedFiles?: ChangedFile[];
    dependencyChanges?: DependencyChange[];
    ci?: { workflow?: string; conclusion?: string };
  };
  const repository = typeof payload.repository === "string" ? payload.repository.toLowerCase() : null;
  const facts: Fact[] = [];
  const resources: ResourceRef[] = [];
  const location = (event.provenance.url as string | null | undefined) ?? `${event.source}:${event.externalId}`;

  if (repository) resources.push({ type: "repository", key: repository, repository: null });

  for (const f of Array.isArray(payload.changedFiles) ? payload.changedFiles.slice(0, 3000) : []) {
    if (!f || typeof f.path !== "string") continue;
    resources.push({ type: "path", key: normalizePath(f.path), repository });
    if (f.previousPath) resources.push({ type: "path", key: normalizePath(f.previousPath), repository });
  }

  for (const d of Array.isArray(payload.dependencyChanges) ? payload.dependencyChanges.slice(0, 500) : []) {
    if (!d || typeof d.name !== "string" || typeof d.ecosystem !== "string") continue;
    const subject = packageSubject(d.ecosystem, d.name);
    resources.push({ type: "package", key: `${d.ecosystem.toLowerCase()}:${d.name.toLowerCase()}`, repository: null });
    const where = d.manifest ? `${d.manifest} (${location})` : location;
    if (d.change === "added" || d.change === "removed") {
      facts.push(
        factSchema.parse({
          subject,
          predicate: "dependency_present",
          valueType: "BOOLEAN",
          value: d.change === "added",
          statement: `${d.name} was ${d.change === "added" ? "added to" : "removed from"} the ${d.ecosystem} dependencies${repository ? ` of ${repository}` : ""}`,
          quote: `${d.change === "added" ? "+" : "-"} ${d.name}${d.to ? `@${d.to}` : d.from ? `@${d.from}` : ""}`,
          location: where,
          extractor: "engineering/dependency-diff",
        }),
      );
    }
    if (d.to && d.change !== "removed") {
      facts.push(
        factSchema.parse({
          subject,
          predicate: "version",
          valueType: "VERSION",
          value: d.to.replace(/^[~^>=<\s]+/, ""),
          statement: `${d.name} is now at version ${d.to}`,
          quote: `${d.name}: ${d.from ?? "(new)"} → ${d.to}`,
          location: where,
          extractor: "engineering/dependency-diff",
        }),
      );
    }
  }

  if (payload.ci?.conclusion && payload.ci.workflow) {
    facts.push(
      factSchema.parse({
        subject: `workflow:${normalizeKey(payload.ci.workflow)}`,
        predicate: "ci_passing",
        valueType: "BOOLEAN",
        value: payload.ci.conclusion === "success",
        statement: `CI workflow ${payload.ci.workflow} concluded ${payload.ci.conclusion}`,
        location,
        extractor: "engineering/ci",
      }),
    );
  }

  return { facts, resources };
}

function dependencyFact(facts: Fact[], subject: string): Fact | undefined {
  const want = canonicalPackageSubject(normalizeKey(subject) ?? "");
  return facts.find(
    (f) =>
      normalizeKey(f.predicate) === "dependency_present" &&
      canonicalPackageSubject(normalizeKey(f.subject) ?? "") === want,
  );
}

export const engineeringPack: DomainPack = {
  id: "engineering",
  label: "Engineering",
  resourceTypes: ["repository", "path", "package", "service", "database", "table", "endpoint", "infrastructure", "architecture"],
  predicateAliases: {
    latency_p95_ms: "p95_latency_ms",
    p95_latency: "p95_latency_ms",
    requests_per_second: "throughput_rps",
    rps: "throughput_rps",
    writes_per_second: "write_throughput_per_s",
    installed: "dependency_present",
    uses_dependency: "dependency_present",
  },
  subjectAliases: {},
  canonicalSubject: canonicalPackageSubject,
  authorityFor(event) {
    return AUTHORITY.find((a) => a.match(event))?.authority ?? null;
  },
  extract: extractEngineering,
  evaluateConstraint(constraint, observed): ConstraintCheck | null {
    const rule = constraint.rule;
    switch (rule.kind) {
      case "dependency_present": {
        const f = dependencyFact(observed.facts, rule.subject);
        if (!f) return { violated: false, explanation: `No change to ${rule.subject} observed.` };
        return f.value === false
          ? { violated: true, explanation: `${f.statement}, but "${constraint.statement}" requires it.` }
          : { violated: false, explanation: `${rule.subject} remains present.` };
      }
      case "dependency_absent": {
        const f = dependencyFact(observed.facts, rule.subject);
        if (!f) return { violated: false, explanation: `No change to ${rule.subject} observed.` };
        return f.value === true
          ? { violated: true, explanation: `${f.statement}, but "${constraint.statement}" rules it out.` }
          : { violated: false, explanation: `${rule.subject} remains absent.` };
      }
      case "path_protected": {
        const patterns = rule.paths.map((p) => globToRegExp(p));
        const touched = observed.resources.filter(
          (r) =>
            r.type === "path" &&
            (!rule.repository || !r.repository || r.repository.toLowerCase() === rule.repository.toLowerCase()) &&
            patterns.some((re) => re.test(r.key)),
        );
        return touched.length > 0
          ? {
              violated: true,
              explanation: `Changes touch protected paths (${touched.slice(0, 5).map((t) => t.key).join(", ")}${touched.length > 5 ? ", …" : ""}) governed by "${constraint.statement}".`,
            }
          : { violated: false, explanation: "No protected paths touched." };
      }
      default:
        return null;
    }
  },
  vocabulary: { decision: "architecture decision", assumption: "assumption", resource: "component" },
};

/**
 * Computes dependency changes between two versions of a manifest. Used by
 * the GitHub integration and `decisionloop check` on local diffs.
 */
export function diffPackageJson(before: string | null, after: string | null, manifest = "package.json"): DependencyChange[] {
  const deps = (text: string | null): Record<string, string> => {
    if (!text) return {};
    try {
      const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
      return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.optionalDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    } catch {
      return {};
    }
  };
  const a = deps(before);
  const b = deps(after);
  const changes: DependencyChange[] = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(name in a)) changes.push({ ecosystem: "npm", name, change: "added", to: b[name] ?? null, manifest });
    else if (!(name in b)) changes.push({ ecosystem: "npm", name, change: "removed", from: a[name] ?? null, manifest });
    else if (a[name] !== b[name]) changes.push({ ecosystem: "npm", name, change: "changed", from: a[name] ?? null, to: b[name] ?? null, manifest });
  }
  return changes;
}
