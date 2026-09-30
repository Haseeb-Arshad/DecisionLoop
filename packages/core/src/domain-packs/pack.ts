import type { Fact } from "../assumptions/facts";
import type { EvaluateOptions } from "../assumptions/evaluate";
import type { InboundEvent } from "../events/event";
import type { PolicyRule } from "../policy/policy";
import type { ResourceRef } from "../resources/resources";
import type { DecisionConstraint } from "../types/domain";
import { evaluateGenericConstraint } from "./constraints";
import { ENGINEERING_GUIDANCE, type PackGuidance } from "./guidance";

/**
 * Domain packs (spec §29–§30) carry everything vertical-specific: resource
 * types, deterministic fact extractors for source payloads, predicate and
 * subject vocabularies, authority defaults, constraint evaluators and
 * optional policy templates. The core engine consults the registry and
 * never branches on a domain name.
 */

export interface ConstraintCheck {
  violated: boolean;
  explanation: string;
}

export interface DomainPack {
  id: string;
  label: string;
  resourceTypes: string[];
  /** Normalized alias → normalized canonical predicate. */
  predicateAliases: Record<string, string>;
  subjectAliases: Record<string, string>;
  canonicalSubject?(normalized: string): string;
  /** Default authority for an event from a source this pack understands, or null. */
  authorityFor(event: InboundEvent): number | null;
  /** Deterministic facts and resources from source-specific payloads. */
  extract(event: InboundEvent): { facts: Fact[]; resources: ResourceRef[] };
  /** null = this pack doesn't evaluate that rule kind. */
  evaluateConstraint(
    constraint: DecisionConstraint,
    observed: { facts: Fact[]; resources: ResourceRef[] },
  ): ConstraintCheck | null;
  policyTemplates?: PolicyRule[];
  vocabulary?: Record<string, string>;
  /** What agents are told in this domain. Omitted = the engineering wording. */
  guidance?: PackGuidance;
  /** Type given to a bare name such as "Acme Corp" (default: a file path, as in engineering). */
  defaultResourceType?: string;
}

export class DomainRegistry {
  /**
   * @param primaryId the domain whose wording agents hear and whose defaults
   *   (new-decision domain, bare resource names) apply. Defaults to
   *   engineering when registered, otherwise the first pack.
   */
  constructor(
    readonly packs: DomainPack[],
    readonly primaryId?: string,
  ) {}

  primary(): DomainPack | undefined {
    return (this.primaryId ? this.get(this.primaryId) : undefined) ?? this.get("engineering") ?? this.packs[0];
  }

  guidance(): PackGuidance {
    return this.primary()?.guidance ?? ENGINEERING_GUIDANCE;
  }

  /** Policy templates shipped by packs, applied after the core defaults. */
  policyTemplates(): PolicyRule[] {
    return this.packs.flatMap((p) => p.policyTemplates ?? []);
  }

  get(id: string): DomainPack | undefined {
    return this.packs.find((p) => p.id === id);
  }

  evaluateOptions(): EvaluateOptions {
    const predicateAliases = Object.assign({}, ...this.packs.map((p) => p.predicateAliases)) as Record<string, string>;
    const subjectAliases = Object.assign({}, ...this.packs.map((p) => p.subjectAliases)) as Record<string, string>;
    const canonicalizers = this.packs.flatMap((p) => (p.canonicalSubject ? [p.canonicalSubject.bind(p)] : []));
    return {
      predicateAliases,
      subjectAliases,
      canonicalSubject: canonicalizers.length
        ? (s) => canonicalizers.reduce((acc, fn) => fn(acc), s)
        : undefined,
    };
  }

  authorityFor(event: InboundEvent): number | null {
    for (const pack of this.packs) {
      const a = pack.authorityFor(event);
      if (a !== null) return a;
    }
    return null;
  }

  extract(event: InboundEvent): { facts: Fact[]; resources: ResourceRef[] } {
    const facts: Fact[] = [];
    const resources: ResourceRef[] = [];
    for (const pack of this.packs) {
      const out = pack.extract(event);
      facts.push(...out.facts);
      resources.push(...out.resources);
    }
    return { facts, resources };
  }

  evaluateConstraint(
    constraint: DecisionConstraint,
    observed: { facts: Fact[]; resources: ResourceRef[] },
  ): ConstraintCheck | null {
    const generic = evaluateGenericConstraint(constraint, observed, this.evaluateOptions());
    if (generic) return generic;
    for (const pack of this.packs) {
      const r = pack.evaluateConstraint(constraint, observed);
      if (r) return r;
    }
    return null;
  }
}
