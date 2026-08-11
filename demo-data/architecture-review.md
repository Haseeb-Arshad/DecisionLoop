# Analytics Platform — Internal Architecture Review

**Project:** Analytics Infrastructure
**Author:** Elias Grant, Engineering Lead
**Reviewers:** Maya Chen (CTO), Sofia Almeida (Data Platform), Tom Whitfield (Security)
**Status:** Final — circulated ahead of vendor decision

---

## 1. Purpose

This review assesses SignalForge and MetricLake against Northstar Commerce's analytics
requirements. It is an engineering assessment; the commercial decision sits with Maya.

## 2. Requirements recap

Non-negotiable:

- **R1.** EU data residency for all customer event data (GDPR posture, legal sign-off)
- **R2.** Sustained ingestion of current volume with headroom for 12 months
- **R3.** SOC 2 Type II or equivalent
- **R4.** Data export on exit without vendor assistance

Strongly preferred:

- **R5.** Sub-4-hour P1 support response
- **R6.** Integration effort under one engineering month
- **R7.** Annual cost within the approved $25,000 envelope

## 3. Current and projected volume

Measured over the trailing 90 days from our ingestion gateway logs:

| Metric | Value |
|---|---|
| Median daily events | 1.82M |
| P95 daily events | 2.94M |
| Peak observed (Black Friday) | 3.11M |
| Trailing 12-month growth | 34% |

Extrapolating the current growth rate forward 12 months puts projected peak at roughly
4.2M events/day. That sits inside a 5M/day committed band, but not comfortably — a single
unplanned campaign or a catalogue expansion could approach it.

Sofia's view, which I share: 5M/day is adequate for the initial term but is not a two-year
answer. We should expect to revisit capacity at renewal regardless of vendor.

## 4. Vendor assessment

### 4.1 SignalForge

**Meets R1** — EU residency is contractual (MSA clause 7.3), Frankfurt and Dublin only.
Tom has reviewed and is satisfied this clears the legal requirement.

**Meets R2, with the caveat above** — 5M/day committed, 8M burst. Covers projected peak
with ~19% headroom on a 12-month horizon.

**Meets R3** — ISO 27001 and SOC 2 Type II, current.

**Meets R4** — Parquet/NDJSON export within 14 days, self-service.

**Meets R5** — 2 business hour P1 target; their stated actual median is 47 minutes. We
called two reference customers, both of whom described support responsiveness as the
strongest part of the relationship.

**Meets R6** — 2–3 engineer-weeks estimated. Our own read of their API docs supports this;
the ingestion contract is straightforward and the SDKs are well-maintained.

**Meets R7** — $20,000/year, $5,000 inside the envelope.

*Concern:* no renewal price cap in the Growth tier standard agreement. Their proposal is
explicit that renewal pricing is reset annually. If we build on SignalForge and the renewal
comes back materially higher, our negotiating position is weak because migration cost is
real. I raised this with Daniel; he was unwilling to commit to a cap at this deal size.

### 4.2 MetricLake

**Meets R1** — EU residency on Enterprise tier, Frankfurt primary.

**Exceeds R2** — 10M/day committed. This is genuine headroom, not marketing: it would
absorb two consecutive growth years without a tier change.

**Meets R3** — ISO 27001, SOC 2 Type II.

**Meets R4** — standard export tooling.

**Fails R5** — 24 business hour P1 target as standard. The Premium Support add-on fixes
this but adds $6,000/year, taking total to $35,000.

**Fails R6** — 4–6 engineer-weeks. The up-front schema modelling is defensible engineering
and probably reduces long-run maintenance, but it is real cost in the first quarter and we
are capacity-constrained until Q3.

**Fails R7** — $29,000/year, $4,000 over the envelope. The 3-year option at $26,500/year
is still over, though closer.

*Notable:* the 3-year price lock is the single most attractive thing in either proposal from
a planning perspective. It is the direct answer to my concern about SignalForge's renewal
exposure.

## 5. Comparison summary

| Requirement | SignalForge | MetricLake |
|---|---|---|
| R1 EU residency | Yes (contractual) | Yes (Enterprise tier) |
| R2 Throughput | 5M/day | 10M/day |
| R3 Certification | Yes | Yes |
| R4 Export | Yes | Yes |
| R5 P1 response | 2h | 24h (4h at +$6K) |
| R6 Integration | 2–3 weeks | 4–6 weeks |
| R7 Annual cost | $20,000 | $29,000 |

## 6. Recommendation

**Recommend SignalForge for the initial term.**

It meets every non-negotiable requirement, meets both strong preferences, and lands $5,000
under budget. MetricLake's advantages — capacity headroom and the multi-year price lock —
are real but are answers to problems we do not have today, at a price we have not approved.

## 7. Risks to record with the decision

1. **Renewal exposure (highest).** SignalForge does not cap renewal pricing. If renewal
   comes back significantly above $25,000, the economic basis of this decision no longer
   holds and MetricLake should be re-evaluated — at which point their price-locked option
   becomes materially more attractive than it is today. **This assumption is worth tracking
   explicitly.**
2. **Capacity at 24 months.** 5M/day is a 12-month answer, not a 24-month one.
3. **Support quality is reputational, not contractual.** Their 47-minute median is a stated
   average, not an SLA. The contractual commitment is 2 hours.
4. **Migration cost is asymmetric.** Once instrumented, moving vendors costs roughly
   6 engineer-weeks by our estimate. This weakens us at every future renewal.

## 8. Decision record request

If Maya approves SignalForge, I'd like the following recorded explicitly as the conditions
this decision depends on:

- SignalForge annual cost remains **below $25,000**
- EU data residency remains available
- Required throughput remains **below 5M events/day**

If any of those three stops being true, this decision should be reopened rather than
assumed to still hold.

---

*Internal document. Circulated to the named reviewers only.*
