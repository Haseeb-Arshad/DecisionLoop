import { evaluateAssumption, type EvaluableAssumption } from "@decisionloop/core/assumptions/evaluate";
import { fromLegacyFact } from "@decisionloop/core/assumptions/facts";
import type { ConflictAnalysisInput, ConflictJudgment } from "@/lib/ai/reasoningProvider";
import type { Assumption } from "@/lib/types";

/**
 * Deterministic conflict check (decision.md §21: "price < 25000 vs price =
 * 42000 should not require an LLM").
 *
 * This used to live inside BedrockReasoningProvider.analyzeConflict, which
 * made "deterministic before model" a property of one provider: with any
 * other provider (including the integration-test stub) structured
 * contradictions went to the model. It now runs in the engine, before any
 * provider is consulted, using the core evaluator.
 */

export function toEvaluableAssumption(a: Assumption): EvaluableAssumption {
  return {
    statement: a.statement,
    subject: a.subject,
    predicate: a.predicate,
    valueType: a.valueType,
    operator: a.operatorV2,
    expected: a.expected,
    unit: a.unit,
  };
}

export function tryDeterministicConflictCheck(
  input: ConflictAnalysisInput,
): ConflictJudgment | null {
  const { fact, assumption, otherOptionNames } = input;
  const result = evaluateAssumption(toEvaluableAssumption(assumption), fromLegacyFact(fact));
  if (result.status !== "EVALUATED") return null;

  const contradicts = result.relation === "CONTRADICTS";
  return {
    relation: result.relation,
    conflictType: "VALUE_CHANGED",
    // The comparison is exact; remaining uncertainty is extraction
    // confidence, which 1.x numeric facts don't carry (so 1).
    confidence: result.confidence,
    explanation: result.explanation,
    oldValue: result.expectedText,
    newValue: result.observedText,
    sourceQuote: fact.sourceQuote || fact.statement,
    suggestedOptionName: contradicts && otherOptionNames.length === 1 ? otherOptionNames[0]! : "",
    method: "DETERMINISTIC",
  };
}
