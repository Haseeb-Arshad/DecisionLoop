import { describe, expect, it } from "vitest";
import { renderReport, runEvaluation } from "../../evals/runner";

/**
 * Behavioural gate (spec §27: "A DecisionLoop version is not ready merely
 * because tests pass"). Thresholds are the dataset's expectations; loosening
 * one should be a deliberate, reviewed change.
 */
describe("behavioural evaluation", () => {
  it("meets the alpha thresholds on the evaluation dataset", async () => {
    const report = await runEvaluation({ databaseUrl: process.env.DATABASE_URL! });
    const failed = report.cases.filter((c) => !c.pass);
    expect(failed, renderReport(report)).toEqual([]);
    const m = report.metrics;
    expect(m.retrievalRecall).toBe(1);
    expect(m.firstHitRate).toBeGreaterThanOrEqual(0.9);
    expect(m.forbiddenHits).toBe(0);
    expect(m.conflictPrecision).toBe(1);
    expect(m.conflictRecall).toBe(1);
    expect(m.falseAlertRate).toBe(0);
    expect(m.tenantLeaks).toBe(0);
    expect(m.contextTokensMax).toBeLessThan(1500);
  }, 120_000);
});
