import { factSchema, type Fact } from "../assumptions/facts";
import { normalizeKey } from "../assumptions/model";
import type { InboundEvent } from "../events/event";
import type { ResourceRef } from "../resources/resources";
import type { DomainPack } from "./pack";

/**
 * Proof-of-concept domain packs beyond engineering (spec §29). Same engine,
 * different vocabulary: resource types, predicate aliases, source authority,
 * deterministic extractors for structured payloads, and policy templates.
 * Unstructured inputs (quotes as PDFs, research write-ups) go through the
 * generic evidence path and a reasoning model like any other document.
 *
 * Shared payload shape understood by all three:
 *   payload.metrics: [{ subject, metric, value, unit?, statement? }]
 */

interface MetricRow {
  subject?: string;
  metric?: string;
  value?: number;
  unit?: string | null;
  statement?: string;
}

function metricFacts(event: InboundEvent, extractor: string): Fact[] {
  const rows = (event.payload as { metrics?: MetricRow[] }).metrics;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 200).flatMap((m) => {
    if (typeof m?.metric !== "string" || typeof m.value !== "number") return [];
    const parsed = factSchema.safeParse({
      subject: m.subject ?? event.subject ?? null,
      predicate: m.metric,
      valueType: "NUMBER",
      value: m.value,
      unit: m.unit ?? null,
      statement: m.statement ?? `${m.subject ?? "value"} ${m.metric} = ${m.value}${m.unit ? ` ${m.unit}` : ""}`,
      location: (event.provenance.url as string | null | undefined) ?? `${event.source}:${event.externalId}`,
      extractor,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

function authorityTable(table: Record<string, number>) {
  return (event: InboundEvent): number | null => table[`${event.source}:${event.type}`] ?? table[`${event.source}:*`] ?? null;
}

// ── Procurement ─────────────────────────────────────────────────────────────

interface Quote {
  vendor?: string;
  unitPrice?: number;
  annualCost?: number;
  currency?: string;
  leadTimeDays?: number;
  moq?: number;
}

export const procurementPack: DomainPack = {
  id: "procurement",
  label: "Procurement",
  resourceTypes: ["vendor", "supplier", "contract", "product", "category"],
  predicateAliases: {
    unit_cost: "unit_price",
    price_per_unit: "unit_price",
    annual_price: "annual_cost",
    lead_time: "lead_time_days",
    minimum_order_quantity: "moq",
    min_order_qty: "moq",
    certification: "certifications",
  },
  subjectAliases: {},
  canonicalSubject: (s) => s.replace(/^supplier:/, "vendor:"),
  authorityFor: authorityTable({
    "procurement:contract.signed": 0.95,
    "procurement:quote.received": 0.85,
    "procurement:supplier.notice": 0.85,
    "procurement:quality.report": 0.8,
    "procurement:*": 0.7,
  }),
  extract(event) {
    const facts: Fact[] = metricFacts(event, "procurement/metrics");
    const resources: ResourceRef[] = [];
    const quote = (event.payload as { quote?: Quote }).quote;
    if (quote?.vendor) {
      const subject = `vendor:${normalizeKey(quote.vendor)}`;
      resources.push({ type: "vendor", key: normalizeKey(quote.vendor)!, repository: null });
      const unit = (per: string) => `${(quote.currency ?? "USD").toUpperCase()}/${per}`;
      const add = (predicate: string, value: number | undefined, u: string | null, label: string) => {
        if (typeof value !== "number") return;
        facts.push(
          factSchema.parse({
            subject,
            predicate,
            valueType: "NUMBER",
            value,
            unit: u,
            statement: `${quote.vendor} quoted ${label} ${value}${u ? ` ${u}` : ""}`,
            location: (event.provenance.url as string | null | undefined) ?? `${event.source}:${event.externalId}`,
            extractor: "procurement/quote",
          }),
        );
      };
      add("unit_price", quote.unitPrice, unit("unit"), "a unit price of");
      add("annual_cost", quote.annualCost, unit("year"), "an annual cost of");
      add("lead_time_days", quote.leadTimeDays, "days", "a lead time of");
      add("moq", quote.moq, "units", "a minimum order of");
    }
    return { facts, resources };
  },
  evaluateConstraint: () => null,
  vocabulary: { decision: "sourcing decision", resource: "vendor" },
};

// ── Product ─────────────────────────────────────────────────────────────────

export const productPack: DomainPack = {
  id: "product",
  label: "Product",
  resourceTypes: ["feature", "segment", "platform", "experiment"],
  predicateAliases: {
    android_share: "android_demand_share",
    weekly_active_users: "wau",
    retention_d30: "d30_retention",
  },
  subjectAliases: {},
  authorityFor: authorityTable({
    "analytics:experiment.completed": 0.9,
    "analytics:metric.snapshot": 0.85,
    "research:summary.published": 0.6,
    "analytics:*": 0.8,
  }),
  extract: (event) => ({ facts: metricFacts(event, "product/metrics"), resources: [] }),
  evaluateConstraint: () => null,
  vocabulary: { decision: "product decision", resource: "feature" },
};

// ── Finance / FP&A ──────────────────────────────────────────────────────────

export const financePack: DomainPack = {
  id: "finance",
  label: "Finance",
  resourceTypes: ["business_unit", "model", "initiative", "budget", "investment", "forecast"],
  predicateAliases: {
    gross_margin: "gross_margin_pct",
    margin: "gross_margin_pct",
    cac: "customer_acquisition_cost",
    runway: "runway_months",
    churn: "monthly_churn_pct",
  },
  subjectAliases: {},
  authorityFor: authorityTable({
    "finance:report.approved": 0.95,
    "finance:actuals.posted": 0.9,
    "finance:forecast.updated": 0.7,
    "finance:*": 0.75,
  }),
  extract: (event) => ({ facts: metricFacts(event, "finance/metrics"), resources: [] }),
  evaluateConstraint: () => null,
  // Spec §29: human review stays mandatory for material financial decisions.
  // Any evidence that would challenge or invalidate a finance assumption
  // opens a review, whatever its authority.
  policyTemplates: [
    {
      scope: "evaluation",
      name: "finance_material_review",
      description: "Any change to a finance decision's assumptions is reviewed by a person.",
      when: { domain: ["finance"], proposedValidity: ["CHALLENGED", "INVALIDATED"] },
      actions: ["require_human_review", "notify_dashboard"],
    },
  ],
  vocabulary: { decision: "financial decision", resource: "initiative" },
};
