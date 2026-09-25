import type { Fact } from "./facts";
import {
  compareVersions,
  formatExpected,
  normalizeKey,
  normalizeUnit,
  type ExpectedValue,
  type Operator,
  type ValueType,
} from "./model";

/**
 * Deterministic assumption evaluation (spec §6, §17: "Do not turn arithmetic,
 * comparisons or status transitions into model prompts").
 *
 * Given one assumption and one fact, either the comparison is decidable by
 * code — same subject, same predicate, compatible type and unit, a concrete
 * observed value — or it is NOT_APPLICABLE and the caller decides whether a
 * semantic (model) judgment is warranted. This function never guesses: any
 * doubt is NOT_APPLICABLE, with the reason recorded.
 */

export interface EvaluableAssumption {
  statement: string;
  subject: string | null;
  predicate: string | null;
  valueType: ValueType;
  operator: Operator | null;
  expected: ExpectedValue;
  unit: string | null;
}

export type DeterministicEvaluation =
  | { status: "NOT_APPLICABLE"; reason: string }
  | {
      status: "EVALUATED";
      holds: boolean;
      relation: "SUPPORTS" | "CONTRADICTS";
      /**
       * The comparison itself is exact; what remains uncertain is whether
       * the fact was extracted correctly, so confidence is the fact's.
       */
      confidence: number;
      expectedText: string;
      observedText: string;
      explanation: string;
    };

export interface EvaluateOptions {
  /** Domain-pack aliases: normalized alias → normalized canonical key. */
  predicateAliases?: Record<string, string>;
  subjectAliases?: Record<string, string>;
}

function canonical(key: string | null, aliases?: Record<string, string>): string | null {
  if (!key) return null;
  return aliases?.[key] ?? key;
}

function notApplicable(reason: string): DeterministicEvaluation {
  return { status: "NOT_APPLICABLE", reason };
}

export function evaluateAssumption(
  assumption: EvaluableAssumption,
  fact: Fact,
  opts: EvaluateOptions = {},
): DeterministicEvaluation {
  if (assumption.valueType === "TEXT") {
    return notApplicable("Qualitative assumption; only semantic evaluation can judge it.");
  }
  if (!assumption.predicate || !assumption.operator) {
    return notApplicable("Assumption has no structured predicate/operator.");
  }
  if (assumption.expected === null || assumption.expected === undefined) {
    return notApplicable("Assumption has no expected value.");
  }

  const aPred = canonical(normalizeKey(assumption.predicate), opts.predicateAliases);
  const fPred = canonical(normalizeKey(fact.predicate), opts.predicateAliases);
  if (aPred !== fPred) {
    return notApplicable(`Different predicates (${aPred} vs ${fPred}).`);
  }

  // A subject recorded on both sides must match. An assumption without a
  // subject (every 1.x numeric assumption) is matched on predicate alone —
  // retrieval has already tied the fact to this assumption's decision, and
  // the explanation says so rather than hiding it.
  const aSubj = canonical(normalizeKey(assumption.subject), opts.subjectAliases);
  const fSubj = canonical(normalizeKey(fact.subject), opts.subjectAliases);
  if (aSubj && fSubj && aSubj !== fSubj) {
    return notApplicable(`Different subjects (${aSubj} vs ${fSubj}).`);
  }
  if (aSubj && !fSubj) {
    return notApplicable(`Fact names no subject; assumption is about ${aSubj}.`);
  }

  if (fact.operator !== "=") {
    return notApplicable(
      `Fact states a bound (${fact.operator} ${String(fact.value)}), not an observed value.`,
    );
  }

  const aUnit = normalizeUnit(assumption.unit);
  const fUnit = normalizeUnit(fact.unit);
  if (aUnit && fUnit && aUnit !== fUnit) {
    return notApplicable(`Incompatible units (${aUnit} vs ${fUnit}); no conversion is attempted.`);
  }

  const outcome = compare(assumption.valueType, assumption.operator, assumption.expected, fact);
  if (outcome.status === "NOT_APPLICABLE") return outcome;

  const expectedText = `${assumption.operator} ${formatExpected(assumption.expected, assumption.unit)}`;
  const observedText = formatExpected(fact.value as ExpectedValue, fact.unit ?? assumption.unit);
  const subjectNote = aSubj ? "" : " (the assumption records no subject; matched on predicate)";
  const lhs = `${fSubj ?? aSubj ?? "subject"}.${aPred}`;

  return {
    status: "EVALUATED",
    holds: outcome.holds,
    relation: outcome.holds ? "SUPPORTS" : "CONTRADICTS",
    confidence: fact.confidence,
    expectedText,
    observedText,
    explanation: outcome.holds
      ? `Observed ${lhs} = ${observedText}, which satisfies "${expectedText}"${subjectNote}. Checked deterministically.`
      : `Observed ${lhs} = ${observedText}, which violates "${expectedText}" behind "${assumption.statement}"${subjectNote}. Checked deterministically.`,
  };
}

type CompareOutcome = { status: "OK"; holds: boolean } | { status: "NOT_APPLICABLE"; reason: string };

function ordered(op: Operator, cmp: number): boolean | null {
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "=":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    default:
      return null;
  }
}

function compare(
  valueType: ValueType,
  op: Operator,
  expected: Exclude<ExpectedValue, null>,
  fact: Fact,
): CompareOutcome {
  const na = (reason: string): CompareOutcome => ({ status: "NOT_APPLICABLE", reason });
  const v = fact.value;

  switch (valueType) {
    case "NUMBER": {
      if (typeof v !== "number" || typeof expected !== "number") return na("Non-numeric value.");
      const holds = ordered(op, Math.sign(v - expected));
      return holds === null ? na(`Operator ${op} is not numeric.`) : { status: "OK", holds };
    }
    case "BOOLEAN": {
      if (typeof v !== "boolean" || typeof expected !== "boolean") return na("Non-boolean value.");
      if (op === "=") return { status: "OK", holds: v === expected };
      if (op === "!=") return { status: "OK", holds: v !== expected };
      return na(`Operator ${op} is not boolean.`);
    }
    case "CATEGORY": {
      if (typeof v !== "string") return na("Category fact must be a single value.");
      const observed = v.trim().toLowerCase();
      if (op === "IN" || op === "NOT_IN") {
        if (!Array.isArray(expected)) return na(`${op} needs a list.`);
        const inSet = expected.map((e) => e.trim().toLowerCase()).includes(observed);
        return { status: "OK", holds: op === "IN" ? inSet : !inSet };
      }
      if (typeof expected !== "string") return na("Category assumption must name one value.");
      const eq = observed === expected.trim().toLowerCase();
      if (op === "=") return { status: "OK", holds: eq };
      if (op === "!=") return { status: "OK", holds: !eq };
      return na(`Operator ${op} is not categorical.`);
    }
    case "DATE": {
      if (typeof v !== "string" || typeof expected !== "string") return na("Dates must be ISO strings.");
      const a = Date.parse(v);
      const b = Date.parse(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return na("Unparseable date.");
      const holds = ordered(op, Math.sign(a - b));
      return holds === null ? na(`Operator ${op} is not temporal.`) : { status: "OK", holds };
    }
    case "VERSION": {
      if (typeof v !== "string" || typeof expected !== "string") return na("Versions must be strings.");
      const cmp = compareVersions(v, expected);
      if (cmp === null) return na("Unparseable version.");
      const holds = ordered(op, cmp);
      return holds === null ? na(`Operator ${op} is not a version comparison.`) : { status: "OK", holds };
    }
    case "SET": {
      if (typeof expected !== "string") return na("Set assumption must name one element.");
      const element = expected.trim().toLowerCase();
      // Only a complete observed set can prove absence. A single observed
      // element that isn't ours tells us nothing about membership.
      if (Array.isArray(v)) {
        const contains = v.map((x) => x.trim().toLowerCase()).includes(element);
        return { status: "OK", holds: op === "CONTAINS" ? contains : !contains };
      }
      if (typeof v === "string" && v.trim().toLowerCase() === element) {
        return { status: "OK", holds: op === "CONTAINS" };
      }
      return na("A single observed element cannot establish set (non-)membership.");
    }
    case "TEXT":
      return na("Qualitative assumption.");
  }
}
