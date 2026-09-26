import { describe, expect, it } from "vitest";
import { evaluateAssumption, type EvaluableAssumption } from "@decisionloop/core/assumptions/evaluate";
import { factSchema, fromLegacyFact, type FactInput } from "@decisionloop/core/assumptions/facts";
import {
  assumptionSpecSchema,
  canonicalForm,
  compareVersions,
  normalizeKey,
} from "@decisionloop/core/assumptions/model";

function assumption(overrides: Partial<EvaluableAssumption>): EvaluableAssumption {
  return {
    statement: "test assumption",
    subject: null,
    predicate: "annual_cost",
    valueType: "NUMBER",
    operator: "<",
    expected: 25000,
    unit: "USD/year",
    ...overrides,
  };
}

const fact = (f: FactInput) => factSchema.parse(f);

describe("deterministic evaluation by value type", () => {
  it("NUMBER: contradiction and support", () => {
    const a = assumption({ subject: "vendor:signalforge" });
    const over = evaluateAssumption(a, fact({ subject: "vendor:SignalForge", predicate: "annual cost", valueType: "NUMBER", value: 42000, unit: "usd/year", statement: "now $42k" }));
    expect(over).toMatchObject({ status: "EVALUATED", relation: "CONTRADICTS", holds: false });
    const under = evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 20000, unit: "USD/year", statement: "$20k" }));
    expect(under).toMatchObject({ status: "EVALUATED", relation: "SUPPORTS" });
  });

  it("BOOLEAN: requirement no longer holds", () => {
    const a = assumption({ subject: "service:auth", predicate: "immediate_revocation_required", valueType: "BOOLEAN", operator: "=", expected: true, unit: null });
    const r = evaluateAssumption(a, fact({ subject: "service:auth", predicate: "Immediate revocation required", valueType: "BOOLEAN", value: false, statement: "Immediate revocation is no longer required" }));
    expect(r).toMatchObject({ status: "EVALUATED", relation: "CONTRADICTS" });
  });

  it("CATEGORY: IN list", () => {
    const a = assumption({ subject: "vendor:signalforge", predicate: "hosting_region", valueType: "CATEGORY", operator: "IN", expected: ["EU"], unit: null });
    expect(evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "hosting_region", valueType: "CATEGORY", value: "us", statement: "US only" }))).toMatchObject({ relation: "CONTRADICTS" });
    expect(evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "hosting_region", valueType: "CATEGORY", value: "eu", statement: "EU" }))).toMatchObject({ relation: "SUPPORTS" });
  });

  it("DATE: contract expiry", () => {
    const a = assumption({ predicate: "contract_expiry", valueType: "DATE", operator: ">", expected: "2027-01-01", unit: null });
    expect(evaluateAssumption(a, fact({ predicate: "contract_expiry", valueType: "DATE", value: "2026-06-30", statement: "expires mid 2026" }))).toMatchObject({ relation: "CONTRADICTS" });
  });

  it("VERSION: semver ordering", () => {
    const a = assumption({ subject: "npm:react", predicate: "version", valueType: "VERSION", operator: ">=", expected: "4.2", unit: null });
    expect(evaluateAssumption(a, fact({ subject: "npm:react", predicate: "version", valueType: "VERSION", value: "v4.10.0", statement: "4.10" }))).toMatchObject({ relation: "SUPPORTS" });
    expect(evaluateAssumption(a, fact({ subject: "npm:react", predicate: "version", valueType: "VERSION", value: "4.1.9", statement: "4.1.9" }))).toMatchObject({ relation: "CONTRADICTS" });
    expect(compareVersions("4.2.0-beta.1", "4.2.0")).toBe(-1);
  });

  it("SET: only a complete observed set proves absence", () => {
    const a = assumption({ subject: "vendor:x", predicate: "certifications", valueType: "SET", operator: "CONTAINS", expected: "SOC2", unit: null });
    expect(evaluateAssumption(a, fact({ subject: "vendor:x", predicate: "certifications", valueType: "SET", value: ["ISO27001"], statement: "only ISO" }))).toMatchObject({ relation: "CONTRADICTS" });
    expect(evaluateAssumption(a, fact({ subject: "vendor:x", predicate: "certifications", valueType: "SET", value: "ISO27001", statement: "has ISO" }))).toMatchObject({ status: "NOT_APPLICABLE" });
  });

  it("TEXT assumptions are never evaluated deterministically", () => {
    const a = assumption({ valueType: "TEXT", operator: null, expected: null, predicate: null, statement: "vendor maintains European hosting" });
    expect(evaluateAssumption(a, fact({ predicate: "eu_hosting", valueType: "BOOLEAN", value: false, statement: "EU hosting discontinued" })).status).toBe("NOT_APPLICABLE");
  });
});

describe("declines rather than guesses", () => {
  const a = assumption({ subject: "vendor:signalforge" });

  it("different subject", () => {
    const r = evaluateAssumption(a, fact({ subject: "vendor:metriclake", predicate: "annual_cost", valueType: "NUMBER", value: 90000, unit: "USD/year", statement: "x" }));
    expect(r).toMatchObject({ status: "NOT_APPLICABLE" });
  });

  it("incompatible units are not converted", () => {
    const r = evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 3000, unit: "USD/month", statement: "x" }));
    expect(r.status).toBe("NOT_APPLICABLE");
  });

  it("bound-shaped facts", () => {
    const r = evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 30000, operator: "<", unit: "USD/year", statement: "under 30k" }));
    expect(r.status).toBe("NOT_APPLICABLE");
  });

  it("fact without a subject when the assumption names one", () => {
    const r = evaluateAssumption(a, fact({ predicate: "annual_cost", valueType: "NUMBER", value: 42000, unit: "USD/year", statement: "x" }));
    expect(r.status).toBe("NOT_APPLICABLE");
  });

  it("carries extraction confidence rather than claiming certainty", () => {
    const r = evaluateAssumption(a, fact({ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 42000, unit: "USD/year", statement: "x", confidence: 0.6 }));
    expect(r).toMatchObject({ status: "EVALUATED", confidence: 0.6 });
  });
});

describe("1.x compatibility", () => {
  it("legacy subject-less numeric assumptions match on predicate, and say so", () => {
    const legacy = fromLegacyFact({ subject: "SignalForge", metric: "annual_price", operator: "=", value: 42000, unit: "USD/year", statement: "now 42k", sourceQuote: "$42,000" });
    const r = evaluateAssumption(assumption({ predicate: "annual_price" }), legacy);
    expect(r).toMatchObject({ status: "EVALUATED", relation: "CONTRADICTS" });
    if (r.status === "EVALUATED") expect(r.explanation).toMatch(/records no subject/);
  });
});

describe("assumption spec validation", () => {
  it("rejects operators that make no sense for the type", () => {
    expect(assumptionSpecSchema.safeParse({ statement: "x", valueType: "BOOLEAN", operator: "<", expected: true }).success).toBe(false);
    expect(assumptionSpecSchema.safeParse({ statement: "x", valueType: "CATEGORY", operator: "IN", expected: "EU" }).success).toBe(false);
  });

  it("accepts qualitative assumptions without structure", () => {
    expect(assumptionSpecSchema.parse({ statement: "vendor maintains European hosting" }).valueType).toBe("TEXT");
  });

  it("canonical forms", () => {
    expect(canonicalForm({ subject: "Vendor:SignalForge", predicate: "Annual Cost", valueType: "NUMBER", operator: "<", expected: 25000, unit: "USD/year" }))
      .toBe("vendor:signalforge.annual_cost < 25000 usd/year");
    expect(canonicalForm({ valueType: "TEXT", predicate: "x", operator: null })).toBeNull();
    expect(normalizeKey("  EU-Data Residency ")).toBe("eu_data_residency");
  });
});
