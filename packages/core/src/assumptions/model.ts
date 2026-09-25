import { z } from "zod";

/**
 * Generalized assumption representation (docs/v2/00-audit-and-plan.md §8).
 *
 * The 1.x model only understood `metric operator value unit`. That remains a
 * valid NUMBER assumption; the other value types cover what engineering,
 * procurement and compliance decisions actually depend on. A TEXT assumption
 * is qualitative: it is never coerced into a fake number, and can only be
 * evaluated semantically.
 */

export const VALUE_TYPES = [
  "NUMBER",
  "BOOLEAN",
  "CATEGORY",
  "DATE",
  "VERSION",
  "SET",
  "TEXT",
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const OPERATORS = [
  "<",
  "<=",
  ">",
  ">=",
  "=",
  "!=",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "NOT_CONTAINS",
] as const;
export type Operator = (typeof OPERATORS)[number];

/** Which operators are meaningful for which value type. */
export const OPERATORS_BY_TYPE: Record<ValueType, readonly Operator[]> = {
  NUMBER: ["<", "<=", ">", ">=", "=", "!="],
  BOOLEAN: ["=", "!="],
  CATEGORY: ["=", "!=", "IN", "NOT_IN"],
  DATE: ["<", "<=", ">", ">=", "=", "!="],
  VERSION: ["<", "<=", ">", ">=", "=", "!="],
  SET: ["CONTAINS", "NOT_CONTAINS"],
  TEXT: [],
};

export const VERIFICATION_POLICIES = [
  "DETERMINISTIC_FIRST",
  "SEMANTIC_ONLY",
  "MANUAL",
] as const;
export type VerificationPolicy = (typeof VERIFICATION_POLICIES)[number];

export type ExpectedValue = number | boolean | string | string[] | null;

const expectedValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()),
  z.null(),
]);

export const assumptionProvenanceSchema = z.object({
  source: z.string().default("human"),
  ref: z.string().nullish(),
  quote: z.string().nullish(),
  extractor: z.string().nullish(),
});
export type AssumptionProvenance = z.infer<typeof assumptionProvenanceSchema>;

export const assumptionSpecSchema = z
  .object({
    statement: z.string().min(1).max(1000),
    subject: z.string().max(200).nullish(),
    predicate: z.string().max(200).nullish(),
    valueType: z.enum(VALUE_TYPES).default("TEXT"),
    operator: z.enum(OPERATORS).nullish(),
    expected: expectedValueSchema.optional(),
    unit: z.string().max(60).nullish(),
    assumptionType: z
      .enum(["QUANTITATIVE", "QUALITATIVE", "REGULATORY", "CAPACITY", "TEMPORAL"])
      .optional(),
    confidence: z.number().min(0).max(1).default(0.7),
    importance: z.number().min(0).max(1).default(0.6),
    authority: z.number().min(0).max(1).default(0.7),
    validFrom: z.string().datetime({ offset: true }).nullish(),
    validUntil: z.string().datetime({ offset: true }).nullish(),
    verificationPolicy: z.enum(VERIFICATION_POLICIES).default("DETERMINISTIC_FIRST"),
    provenance: assumptionProvenanceSchema.nullish(),
  })
  .superRefine((a, ctx) => {
    if (a.valueType === "TEXT") return;
    if (!a.operator) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operator"],
        message: `A ${a.valueType} assumption needs an operator; use valueType TEXT for qualitative assumptions.`,
      });
      return;
    }
    if (!OPERATORS_BY_TYPE[a.valueType].includes(a.operator)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operator"],
        message: `Operator ${a.operator} is not valid for ${a.valueType}. Allowed: ${OPERATORS_BY_TYPE[a.valueType].join(", ")}.`,
      });
    }
    if (a.expected === undefined || a.expected === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: `A ${a.valueType} assumption needs an expected value.`,
      });
      return;
    }
    const problem = checkExpectedShape(a.valueType, a.operator, a.expected);
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expected"], message: problem });
    }
  });

export type AssumptionSpecInput = z.input<typeof assumptionSpecSchema>;
export type AssumptionSpec = z.output<typeof assumptionSpecSchema>;

function checkExpectedShape(
  valueType: ValueType,
  operator: Operator,
  expected: Exclude<ExpectedValue, null>,
): string | null {
  switch (valueType) {
    case "NUMBER":
      return typeof expected === "number" ? null : "NUMBER assumptions expect a number.";
    case "BOOLEAN":
      return typeof expected === "boolean" ? null : "BOOLEAN assumptions expect true or false.";
    case "CATEGORY":
      if (operator === "IN" || operator === "NOT_IN") {
        return Array.isArray(expected) ? null : `${operator} expects a list of categories.`;
      }
      return typeof expected === "string" ? null : "CATEGORY assumptions expect a string.";
    case "DATE":
      return typeof expected === "string" && !Number.isNaN(Date.parse(expected))
        ? null
        : "DATE assumptions expect an ISO-8601 date.";
    case "VERSION":
      return typeof expected === "string" && parseVersion(expected)
        ? null
        : "VERSION assumptions expect a version like 4.2 or v4.2.1.";
    case "SET":
      return typeof expected === "string" ? null : "SET assumptions expect the element to test for.";
    case "TEXT":
      return null;
  }
}

// ── Keys ────────────────────────────────────────────────────────────────────

/**
 * Canonical key form for subjects and predicates, so `EU Data Residency`,
 * `eu-data-residency` and `eu_data_residency` compare equal without a model.
 * `:` `/` `.` `@` are preserved because they carry meaning in resource-like
 * subjects (`package:redis`, `service:auth`, `vendor:signalforge`).
 */
export function normalizeKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:/.@]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key.length > 0 ? key : null;
}

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/\s+/g, "");
  return u.length > 0 ? u : null;
}

// ── Versions ────────────────────────────────────────────────────────────────

/** Parses `4`, `4.2`, `v4.2.1`, `4.2.1-beta.1` into numeric segments; prerelease ignored for ordering ties. */
export function parseVersion(input: string): { parts: number[]; prerelease: string | null } | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim());
  if (!match) return null;
  return {
    parts: match[1]!.split(".").map((p) => Number(p)),
    prerelease: match[2] ?? null,
  };
}

/** Semver-style comparison: missing segments are zero; a prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  const len = Math.max(va.parts.length, vb.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease && vb.prerelease) return va.prerelease < vb.prerelease ? -1 : va.prerelease > vb.prerelease ? 1 : 0;
  return 0;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function formatExpected(value: ExpectedValue | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return "(unspecified)";
  const text = Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
  return unit ? `${text} ${unit}` : text;
}

/**
 * Canonical one-line form, e.g. `vendor:signalforge.annual_cost < 25000 usd/year`
 * or `service:auth.immediate_revocation_required = true`. Null for
 * qualitative assumptions — there is no honest canonical form for prose.
 */
export function canonicalForm(spec: {
  subject?: string | null;
  predicate?: string | null;
  valueType: ValueType;
  operator?: Operator | null;
  expected?: ExpectedValue;
  unit?: string | null;
}): string | null {
  if (spec.valueType === "TEXT" || !spec.predicate || !spec.operator) return null;
  if (spec.expected === undefined || spec.expected === null) return null;
  const subject = normalizeKey(spec.subject);
  const predicate = normalizeKey(spec.predicate);
  const lhs = subject ? `${subject}.${predicate}` : predicate;
  return `${lhs} ${spec.operator} ${formatExpected(spec.expected, normalizeUnit(spec.unit))}`;
}
