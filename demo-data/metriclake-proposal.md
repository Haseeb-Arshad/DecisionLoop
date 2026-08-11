# MetricLake — Enterprise Proposal for Northstar Commerce

**Prepared for:** Maya Chen (CTO) and Elias Grant (Engineering Lead), Northstar Commerce
**Prepared by:** Priya Raman, Solutions Director, MetricLake Inc.
**Quote ID:** ML-Q-2026-0883
**Validity:** 60 days

---

## 1. Overview

MetricLake proposes our **Enterprise tier** for Northstar Commerce's retail event analytics
programme. Enterprise is our standard offering for organisations with EU data residency
requirements and multi-region ingestion.

The annual subscription for Northstar's profile is **$29,000 per year**, billed annually.
This covers platform access, ingestion, storage, and the Enterprise support package.

We recognise this is above the $25,000 guidance shared during the RFP process. Our position
is that the additional capacity and the integration catalogue described below justify the
difference over a 3-year horizon, and we have included a multi-year option in Section 7 that
brings the effective annual cost down.

## 2. Data residency

MetricLake operates EU-resident processing in Frankfurt, Amsterdam, and Stockholm.
Northstar's data would be pinned to Frankfurt as primary with Amsterdam as the DR pair.

EU residency is available on Enterprise tier and above. It is not available on our Team or
Growth tiers, which is part of why Enterprise is the appropriate fit for this requirement
rather than a lower tier.

We hold ISO 27001, SOC 2 Type II, and are currently completing ISO 27701 certification
(expected within two quarters).

## 3. Capacity

Enterprise tier includes committed throughput of **10,000,000 events per day**, with burst
to 15M. This is double the volume band Northstar described as its current requirement.

We have deliberately not proposed a smaller tier. In our experience with retail customers,
event volume growth around catalogue expansion and loyalty programmes is non-linear, and
customers who size to current peak frequently re-tier within 18 months. The Enterprise
headroom is intended to avoid that.

If Northstar's throughput genuinely remains below 5M events/day for the full term, we accept
that a meaningful portion of the committed capacity will go unused.

## 4. Integration catalogue

MetricLake maintains **140+ pre-built connectors**, including native integrations for the
systems named in Northstar's RFP: Shopify Plus, Klaviyo, NetSuite, Snowflake, and Segment.

For the specific stack Northstar described, four of the six source systems have a
first-party MetricLake connector, versus a custom integration path elsewhere.

## 5. Integration effort

Estimated implementation is **4–6 engineer-weeks** to production. This is longer than a
minimal-integration platform because MetricLake's schema modelling step is done up front:
event taxonomy is defined and validated before ingestion, rather than inferred.

Teams generally report this as slower to start and materially cheaper to maintain at the
12-month mark. It is, however, real additional effort in the first quarter.

## 6. Support

Enterprise tier includes:

- Target first response: **24 business hours** for P1, 48 hours for P2
- Coverage: 09:00–17:00 CET, Monday–Friday
- Dedicated Customer Success Manager
- Annual architecture review

We note candidly that our standard Enterprise response target is slower than some
competitors in this segment. Our **Premium Support** add-on reduces P1 target response to
4 hours and extends coverage to 24×5, at an additional $6,000 per year.

## 7. Commercial terms

| Item | Value |
|---|---|
| Annual subscription (Enterprise) | $29,000 |
| Optional Premium Support | +$6,000/year |
| Term | 12 months |
| 3-year option | $26,500/year, price-locked |
| Payment terms | Net 45 |
| Notice period | 90 days |

The 3-year option includes a **contractual price lock** for the full term — the annual fee
cannot increase during the commitment period regardless of usage tier changes, provided
throughput remains within the Enterprise band.

## 8. Why customers choose MetricLake

- Predictable multi-year cost via the price-locked option
- Capacity headroom that survives a growth year without re-tiering
- Broad connector catalogue reduces custom integration maintenance

## 9. Where we are not the best fit

In the interest of a straight comparison: if the decisive criteria are lowest year-one cost
and fastest time-to-first-event, we are unlikely to win on those. Our value case rests on
total cost and operational stability across a multi-year horizon.

---

*Commercial-in-confidence. Pricing reflects the Enterprise tier for the usage profile
described and is subject to the validity period above.*
