import { packFromProfile, type DomainProfileInput } from "./profile";

/**
 * Procurement, product and finance, now written as profiles — the same data
 * anyone can put in `.decisionloop/profiles/*.json`. They were TypeScript
 * packs first; `domainPacks.integration.test.ts` passes unchanged against
 * this version, which is the evidence that profiles lose nothing.
 *
 * Structured payloads these understand:
 *   payload.metrics: [{ subject, metric, value, unit?, statement? }]   (all three)
 *   payload.quote:   { vendor, unitPrice?, annualCost?, currency?, leadTimeDays?, moq? }   (procurement)
 * Unstructured inputs (quotes as PDFs, research write-ups) go through the
 * generic evidence path and a reasoning model like any other document.
 */

export const procurementProfile: DomainProfileInput = {
  id: "procurement",
  label: "Procurement",
  vocabulary: { decision: "sourcing decision", resource: "vendor", action: "commit spend, sign, reorder or switch a supplier" },
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
  subjectPrefixAliases: { supplier: "vendor" },
  authority: {
    "procurement:contract.signed": 0.95,
    "procurement:quote.received": 0.85,
    "procurement:supplier.notice": 0.85,
    "procurement:quality.report": 0.8,
    "procurement:*": 0.7,
  },
  records: [
    {
      path: "quote",
      subjectField: "vendor",
      subjectPrefix: "vendor",
      verb: "quoted",
      defaults: { currency: "USD" },
      facts: [
        { field: "unitPrice", predicate: "unit_price", unit: "{currency}/unit", label: "a unit price of" },
        { field: "annualCost", predicate: "annual_cost", unit: "{currency}/year", label: "an annual cost of" },
        { field: "leadTimeDays", predicate: "lead_time_days", unit: "days", label: "a lead time of" },
        { field: "moq", predicate: "moq", unit: "units", label: "a minimum order of" },
      ],
    },
  ],
};

export const productProfile: DomainProfileInput = {
  id: "product",
  label: "Product",
  vocabulary: { decision: "product decision", resource: "feature", action: "prioritise, ship or cut a feature" },
  resourceTypes: ["feature", "segment", "platform", "experiment"],
  predicateAliases: {
    android_share: "android_demand_share",
    weekly_active_users: "wau",
    retention_d30: "d30_retention",
  },
  authority: {
    "analytics:experiment.completed": 0.9,
    "analytics:metric.snapshot": 0.85,
    "research:summary.published": 0.6,
    "analytics:*": 0.8,
  },
};

export const financeProfile: DomainProfileInput = {
  id: "finance",
  label: "Finance",
  vocabulary: { decision: "financial decision", resource: "initiative", action: "approve, fund or reforecast an initiative" },
  resourceTypes: ["business_unit", "model", "initiative", "budget", "investment", "forecast"],
  predicateAliases: {
    gross_margin: "gross_margin_pct",
    margin: "gross_margin_pct",
    cac: "customer_acquisition_cost",
    runway: "runway_months",
    churn: "monthly_churn_pct",
  },
  authority: {
    "finance:report.approved": 0.95,
    "finance:actuals.posted": 0.9,
    "finance:forecast.updated": 0.7,
    "finance:*": 0.75,
  },
  // Spec §29: human review stays mandatory for material financial decisions.
  // Any evidence that would challenge or invalidate a finance assumption
  // opens a review, whatever its authority.
  policies: [
    {
      scope: "evaluation",
      name: "finance_material_review",
      description: "Any change to a finance decision's assumptions is reviewed by a person.",
      when: { domain: ["finance"], proposedValidity: ["CHALLENGED", "INVALIDATED"] },
      actions: ["require_human_review", "notify_dashboard"],
    },
  ],
};

export const procurementPack = packFromProfile(procurementProfile);
export const productPack = packFromProfile(productProfile);
export const financePack = packFromProfile(financeProfile);
