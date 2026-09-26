import { z } from "zod";

/**
 * Affected resources — the things a decision is *about* (spec §3). They make
 * contextual retrieval precise: an agent editing `src/auth/session.ts` should
 * receive the decision recorded against `src/auth/**` because of a structural
 * match, not because an embedding happened to land nearby.
 *
 * Resource types are open strings so domain packs can add their own
 * (`vendor`, `contract`, `budget` …). Core only gives special meaning to
 * `path`, whose keys are glob patterns scoped by repository.
 */
export const resourceRefSchema = z.object({
  type: z.string().min(1).max(60),
  key: z.string().min(1).max(500),
  repository: z.string().max(200).nullish(),
});
export type ResourceRef = z.infer<typeof resourceRefSchema>;

/**
 * Parses shorthand agents naturally write:
 *   `src/auth/**`            → path
 *   `npm:redis`              → package (`npm:redis`)
 *   `service:auth`           → service `auth`
 *   `repo:company/product`   → repository
 */
const PACKAGE_ECOSYSTEMS = new Set(["npm", "pypi", "go", "cargo", "maven", "gem", "nuget", "composer"]);

export function parseResource(input: string | ResourceRef, repository?: string | null): ResourceRef {
  if (typeof input !== "string") {
    return { ...input, repository: input.repository ?? repository ?? null };
  }
  const raw = input.trim();
  const colon = raw.indexOf(":");
  if (colon > 0 && !raw.slice(0, colon).includes("/")) {
    const prefix = raw.slice(0, colon).toLowerCase();
    const rest = raw.slice(colon + 1);
    if (PACKAGE_ECOSYSTEMS.has(prefix)) {
      return { type: "package", key: `${prefix}:${rest.toLowerCase()}`, repository: null };
    }
    if (prefix === "repo" || prefix === "repository") {
      return { type: "repository", key: rest.toLowerCase(), repository: null };
    }
    if (prefix === "path") {
      return { type: "path", key: normalizePath(rest), repository: repository ?? null };
    }
    return { type: prefix, key: rest.toLowerCase(), repository: null };
  }
  return { type: "path", key: normalizePath(raw), repository: repository ?? null };
}

export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Minimal glob: `**` spans directories, `*` and `?` stay within one segment. */
export function globToRegExp(glob: string): RegExp {
  const g = normalizePath(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**/` matches zero or more whole directories; a trailing `**` matches anything.
        if (g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function staticPrefix(glob: string): string {
  const g = normalizePath(glob);
  const idx = g.search(/[*?]/);
  return idx === -1 ? g : g.slice(0, idx);
}

function isGlob(p: string): boolean {
  return /[*?]/.test(p);
}

/**
 * How strongly a decision's resource matches a resource named in a request.
 * 0 means unrelated. Scores are ordinal, used as the structural retrieval
 * signal — they are not probabilities.
 */
export function resourceMatchScore(recorded: ResourceRef, requested: ResourceRef): number {
  // Repository scoping: two different repositories never match. A resource
  // without a repository is treated as applying to any.
  if (
    recorded.repository &&
    requested.repository &&
    recorded.repository.toLowerCase() !== requested.repository.toLowerCase()
  ) {
    return 0;
  }

  if (recorded.type === "repository" || requested.type === "repository") {
    const recRepo = recorded.type === "repository" ? recorded.key : recorded.repository;
    const reqRepo = requested.type === "repository" ? requested.key : requested.repository;
    if (recRepo && reqRepo && recRepo.toLowerCase() === reqRepo.toLowerCase()) {
      return recorded.type === requested.type ? 1 : 0.3;
    }
    return 0;
  }

  if (recorded.type !== requested.type) return 0;

  if (recorded.type !== "path") {
    return recorded.key.toLowerCase() === requested.key.toLowerCase() ? 1 : 0;
  }

  const a = normalizePath(recorded.key);
  const b = normalizePath(requested.key);
  if (a === b) return 1;
  if (isGlob(a) && !isGlob(b) && globToRegExp(a).test(b)) return 0.9;
  if (isGlob(b) && !isGlob(a) && globToRegExp(b).test(a)) return 0.9;
  // Two globs (or a directory named without a glob): overlap if one static
  // prefix contains the other. `src/auth/**` and `src/**/*.ts` overlap.
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  const dir = (s: string) => (s.endsWith("/") || s === "" ? s : `${s}/`);
  if ((isGlob(a) || isGlob(b)) && (dir(pa).startsWith(dir(pb)) || dir(pb).startsWith(dir(pa)))) {
    return 0.7;
  }
  if (!isGlob(a) && !isGlob(b) && (b.startsWith(dir(a)) || a.startsWith(dir(b)))) return 0.8;
  return 0;
}

/**
 * Which decisions govern any of the requested resources? Groups recorded
 * resource rows by decision and keeps those whose best match reaches
 * `minScore`. Repository rows are ignored: sharing a repository alone is too
 * weak to call a decision affected.
 */
export function matchDecisionsByResources(
  rows: Array<{ decisionId: string; resourceType: string; resourceKey: string; repository: string | null }>,
  requested: ResourceRef[],
  minScore = 0.7,
): Map<string, { score: number; recorded: ResourceRef; requested: ResourceRef }> {
  const byDecision = new Map<string, ResourceRef[]>();
  for (const r of rows) {
    if (r.resourceType === "repository") continue;
    const list = byDecision.get(r.decisionId) ?? [];
    list.push({ type: r.resourceType, key: r.resourceKey, repository: r.repository });
    byDecision.set(r.decisionId, list);
  }
  const out = new Map<string, { score: number; recorded: ResourceRef; requested: ResourceRef }>();
  for (const [id, refs] of byDecision) {
    const m = bestResourceMatch(refs, requested);
    if (m.score >= minScore) out.set(id, { score: m.score, recorded: m.recorded!, requested: m.requested! });
  }
  return out;
}

export function bestResourceMatch(
  recorded: ResourceRef[],
  requested: ResourceRef[],
): { score: number; recorded: ResourceRef | null; requested: ResourceRef | null } {
  let best = { score: 0, recorded: null as ResourceRef | null, requested: null as ResourceRef | null };
  for (const r of recorded) {
    for (const q of requested) {
      const score = resourceMatchScore(r, q);
      if (score > best.score) best = { score, recorded: r, requested: q };
    }
  }
  return best;
}
