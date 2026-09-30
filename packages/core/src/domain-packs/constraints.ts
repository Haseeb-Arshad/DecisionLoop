import { evaluateAssumption, type EvaluateOptions } from "../assumptions/evaluate";
import type { Fact } from "../assumptions/facts";
import { normalizeKey, OPERATORS_BY_TYPE, type ValueType } from "../assumptions/model";
import { globToRegExp, parseResource, resourceMatchScore, type ResourceRef } from "../resources/resources";
import type { DecisionConstraint } from "../types/domain";
import type { ConstraintCheck } from "./pack";

/**
 * Constraint kinds that mean the same thing in every domain. Packs add
 * their own (engineering's dependency and path rules); these are consulted
 * first by the registry.
 *
 *   fact_bound          "no vendor above $50k/year": a predicate (optionally for
 *                       subjects matching a glob) that must satisfy a comparison
 *   resource_protected  "do not contact customer:acme": touching any listed
 *                       resource (globs allowed) violates the constraint
 *
 * Both are evaluated by code. A fact that cannot be compared (other unit,
 * other subject) is never a violation.
 */

export interface ObservedChange {
  facts: Fact[];
  resources: ResourceRef[];
}

function inferValueType(value: unknown): ValueType {
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  return "CATEGORY";
}

function subjectMatches(pattern: string | null | undefined, subject: string | null | undefined): boolean {
  if (!pattern) return true;
  const s = normalizeKey(subject);
  // Same canonical form as normalizeKey, but wildcards survive.
  const p = pattern.trim().toLowerCase().replace(/[^a-z0-9:/.@*?]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s || !p) return false;
  return /[*?]/.test(p) ? globToRegExp(p).test(s) : s === p;
}

export function evaluateGenericConstraint(
  constraint: DecisionConstraint,
  observed: ObservedChange,
  opts: EvaluateOptions = {},
): ConstraintCheck | null {
  const rule = constraint.rule;
  if (rule.kind === "fact_bound") {
    const valueType = rule.valueType ?? inferValueType(rule.value);
    const allowed = OPERATORS_BY_TYPE[valueType] as readonly string[];
    if (!allowed.includes(rule.operator)) {
      return { violated: false, explanation: `Constraint uses operator ${rule.operator}, which is not valid for ${valueType}; not evaluated.` };
    }
    const wanted = normalizeKey(rule.predicate);
    const canonical = (k: string | null) => (k ? (opts.predicateAliases?.[k] ?? k) : k);
    for (const fact of observed.facts) {
      if (canonical(normalizeKey(fact.predicate)) !== canonical(wanted)) continue;
      if (!subjectMatches(rule.subject, fact.subject)) continue;
      const result = evaluateAssumption(
        {
          statement: constraint.statement,
          // The subject was already matched above; compare on the fact's own subject.
          subject: fact.subject ?? null,
          predicate: rule.predicate,
          valueType,
          operator: rule.operator,
          expected: rule.value as never,
          unit: rule.unit ?? null,
        },
        fact,
        opts,
      );
      if (result.status === "EVALUATED" && !result.holds) {
        return { violated: true, explanation: `${fact.statement}; "${constraint.statement}" requires ${rule.predicate} ${result.expectedText}.` };
      }
    }
    return { violated: false, explanation: `No observed value breaks "${constraint.statement}".` };
  }

  if (rule.kind === "resource_protected") {
    const protectedRefs = rule.resources.map((r) => parseResource(r));
    const touched = observed.resources.filter((o) => protectedRefs.some((p) => resourceMatchScore(p, o) >= 0.7));
    return touched.length > 0
      ? {
          violated: true,
          explanation: `This touches ${touched.slice(0, 5).map((t) => `${t.type}:${t.key}`).join(", ")}${touched.length > 5 ? ", …" : ""}, which "${constraint.statement}" protects.`,
        }
      : { violated: false, explanation: "No protected resources touched." };
  }

  return null;
}
