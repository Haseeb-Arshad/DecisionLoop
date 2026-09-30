import { z } from "zod";
import { factSchema, type Fact } from "../assumptions/facts";
import { normalizeKey } from "../assumptions/model";
import type { InboundEvent } from "../events/event";
import { policyRuleSchema } from "../policy/policy";
import type { ResourceRef } from "../resources/resources";
import { guidanceFromVocabulary, type PackGuidance } from "./guidance";
import type { DomainPack } from "./pack";

/**
 * Domain profiles: a domain described as data.
 *
 * A profile is a JSON file — no code, no expressions — that teaches the
 * engine a new kind of work: what its things are called, which resource
 * types exist, how its source systems are trusted, how to read their
 * payloads into facts, and which review policies apply. `packFromProfile`
 * turns it into the same `DomainPack` the TypeScript packs implement, so
 * the engine has exactly one extension point.
 *
 * What a profile cannot do, on purpose: run code, reach the network, weaken
 * a built-in safety rule (policies can only add review), or claim authority
 * for a payload — the receiving surface decides which source an event came
 * from; the profile only says how much that source is trusted.
 */

const key = z.string().min(1).max(120);

const factMapping = z.object({
  /** Field of the record holding the value. */
  field: z.string().min(1).max(80),
  predicate: key,
  valueType: z.enum(["NUMBER", "BOOLEAN", "CATEGORY"]).default("NUMBER"),
  /** `USD/unit`, or `{currency}/unit` to interpolate another field of the record (upper-cased). */
  unit: z.string().max(60).nullish(),
  /** Reads as "<subject> <verb> <label> <value>": "Acme quoted a unit price of 4.7 USD/unit". */
  label: z.string().max(120).optional(),
});

const recordMapping = z.object({
  /** Key of `payload` holding one object, or an array of objects. */
  path: z.string().min(1).max(80),
  /** The record field naming the thing the facts are about. */
  subjectField: z.string().min(1).max(80),
  /** `vendor` → subject `vendor:acme`. */
  subjectPrefix: z.string().min(1).max(60),
  /** Also register the subject as a resource of this type (defaults to the prefix). */
  resourceType: z.string().max(60).optional(),
  verb: z.string().max(40).default("reported"),
  defaults: z.record(z.string().max(60)).default({}),
  facts: z.array(factMapping).min(1).max(40),
});

export const profileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, "Use 2–40 lowercase letters, digits, - or _."),
  label: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  /** How this domain names things; also seeds agent-facing wording. */
  vocabulary: z
    .object({
      decision: z.string().max(60).default("decision"),
      assumption: z.string().max(60).default("assumption"),
      resource: z.string().max(60).default("resource"),
      action: z.string().max(160).default("take an action that a standing decision may govern"),
    })
    .default({}),
  /** Overrides for individual agent-facing strings; anything omitted is generated from the vocabulary. */
  guidance: z
    .object({
      instructions: z.string().max(2000),
      noDecisionHint: z.string().max(500),
      contextToolDescription: z.string().max(1000),
      proposeToolDescription: z.string().max(1000),
      qualifyResources: z.boolean(),
      actionCheck: z.boolean(),
    })
    .partial()
    .default({}),
  /** What a bare name like "Acme Corp" means when it is not `type:key` and not a path. */
  defaultResourceType: z.string().max(60).optional(),
  resourceTypes: z.array(z.string().max(60)).max(60).default([]),
  predicateAliases: z.record(z.string().max(120)).default({}),
  subjectAliases: z.record(z.string().max(120)).default({}),
  /** `supplier` → `vendor` rewrites subjects `supplier:x` to `vendor:x`. */
  subjectPrefixAliases: z.record(z.string().max(60)).default({}),
  /** `source:type` or `source:*` → authority in [0,1]. */
  authority: z.record(z.number().min(0).max(1)).default({}),
  /** Read `payload.metrics: [{ subject, metric, value, unit?, statement? }]`. */
  acceptMetrics: z.boolean().default(true),
  records: z.array(recordMapping).max(20).default([]),
  policies: z.array(policyRuleSchema).max(20).default([]),
});

export type DomainProfile = z.infer<typeof profileSchema>;
export type DomainProfileInput = z.input<typeof profileSchema>;

export function parseProfile(input: unknown): DomainProfile {
  return profileSchema.parse(input);
}

interface MetricRow {
  subject?: string;
  metric?: string;
  value?: number;
  unit?: string | null;
  statement?: string;
}

function locationOf(event: InboundEvent): string {
  return (event.provenance.url as string | null | undefined) ?? `${event.source}:${event.externalId}`;
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
      location: locationOf(event),
      extractor,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

function interpolate(template: string, record: Record<string, unknown>, defaults: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = record[name];
    const text = typeof v === "string" && v.trim() ? v : (defaults[name] ?? "");
    return text.toUpperCase();
  });
}

function recordFacts(
  event: InboundEvent,
  mappings: DomainProfile["records"],
  extractor: string,
): { facts: Fact[]; resources: ResourceRef[] } {
  const facts: Fact[] = [];
  const resources: ResourceRef[] = [];
  for (const mapping of mappings) {
    const raw = event.payload[mapping.path];
    const records = (Array.isArray(raw) ? raw : [raw]).filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object").slice(0, 200);
    for (const record of records) {
      const name = record[mapping.subjectField];
      const slug = typeof name === "string" ? normalizeKey(name) : null;
      if (!slug || typeof name !== "string") continue;
      const subject = `${mapping.subjectPrefix}:${slug}`;
      resources.push({ type: mapping.resourceType ?? mapping.subjectPrefix, key: slug, repository: null });
      for (const f of mapping.facts) {
        const value = record[f.field];
        const ok =
          (f.valueType === "NUMBER" && typeof value === "number") ||
          (f.valueType === "BOOLEAN" && typeof value === "boolean") ||
          (f.valueType === "CATEGORY" && typeof value === "string");
        if (!ok) continue;
        const unit = f.unit ? interpolate(f.unit, record, mapping.defaults) : null;
        const parsed = factSchema.safeParse({
          subject,
          predicate: f.predicate,
          valueType: f.valueType,
          value,
          unit,
          statement: `${name} ${mapping.verb} ${f.label ? `${f.label} ` : `${f.predicate} `}${String(value)}${unit ? ` ${unit}` : ""}`,
          location: locationOf(event),
          extractor,
        });
        if (parsed.success) facts.push(parsed.data);
      }
    }
  }
  return { facts, resources };
}

export function packFromProfile(input: DomainProfileInput | DomainProfile): DomainPack {
  const p = profileSchema.parse(input);
  const generated = guidanceFromVocabulary({ decision: p.vocabulary.decision, action: p.vocabulary.action, resource: p.vocabulary.resource });
  const guidance: PackGuidance = { ...generated, ...p.guidance };
  const prefixAliases = Object.entries(p.subjectPrefixAliases);
  const authorityTable = p.authority;

  return {
    id: p.id,
    label: p.label,
    resourceTypes: p.resourceTypes,
    predicateAliases: Object.fromEntries(Object.entries(p.predicateAliases).map(([a, c]) => [normalizeKey(a) ?? a, normalizeKey(c) ?? c])),
    subjectAliases: Object.fromEntries(Object.entries(p.subjectAliases).map(([a, c]) => [normalizeKey(a) ?? a, normalizeKey(c) ?? c])),
    canonicalSubject: prefixAliases.length
      ? (s) => {
          for (const [from, to] of prefixAliases) if (s.startsWith(`${from}:`)) return `${to}:${s.slice(from.length + 1)}`;
          return s;
        }
      : undefined,
    authorityFor: (event) => authorityTable[`${event.source}:${event.type}`] ?? authorityTable[`${event.source}:*`] ?? null,
    extract(event) {
      const fromRecords = recordFacts(event, p.records, `${p.id}/records`);
      const metrics = p.acceptMetrics ? metricFacts(event, `${p.id}/metrics`) : [];
      // Metrics first, then records: the order the built-in procurement pack always used.
      return { facts: [...metrics, ...fromRecords.facts], resources: fromRecords.resources };
    },
    evaluateConstraint: () => null,
    policyTemplates: p.policies,
    vocabulary: { ...p.vocabulary },
    guidance,
    defaultResourceType: p.defaultResourceType,
  };
}
