# SignalForge — Commercial Proposal for Northstar Commerce

**Prepared for:** Maya Chen, CTO, Northstar Commerce
**Prepared by:** Daniel Okafor, Enterprise Accounts, SignalForge Ltd.
**Proposal reference:** SF-NSC-4471
**Valid until:** 45 days from issue

---

## 1. Executive summary

SignalForge proposes its **Growth tier** event analytics platform to Northstar Commerce,
covering ingestion, stream processing, and retention for the retail analytics workload
described in your RFP.

Growth tier is offered at **$20,000 per year** for Northstar's usage band, billed annually
in advance. This is inclusive of the standard support package and all platform features
listed in Section 4. There are no separate ingestion, egress, or seat charges within the
committed volume.

We understand from the RFP that budget approval for this category sits at $25,000 per year,
and have structured the Growth tier commitment to sit comfortably inside that envelope with
headroom for the volume growth described in Section 3.

## 2. Data residency and compliance

All Northstar Commerce data will be processed and stored within the **European Union**,
specifically in our Frankfurt (eu-central-1) and Dublin (eu-west-1) regions. No customer
event data leaves the EU at any point in the pipeline, including for backup and disaster
recovery, which replicate between those two EU regions only.

SignalForge holds ISO 27001 and SOC 2 Type II certifications. Our subprocessor list is
published quarterly and Northstar will receive 30 days' notice of any change.

The EU residency guarantee is contractual, not best-effort, and is written into the Master
Services Agreement at clause 7.3.

## 3. Capacity and throughput

The Growth tier committed throughput is **5,000,000 events per day**, measured as a
30-day rolling average with burst allowance to 8M events on any single day.

From the volumes shared during discovery, Northstar currently peaks at approximately
3.1M events/day during promotional periods, with a trailing median closer to 1.8M. The
Growth tier therefore accommodates roughly 60% headroom against current peak.

Should sustained throughput exceed the committed 5M events/day, the account would need to
move to our Scale tier. We would flag this at 80% sustained utilisation and work with your
team on timing. Scale tier pricing is quoted separately and is materially higher than
Growth; we have not included it here as it is not expected to be relevant within the
initial term.

## 4. Included platform features

- Real-time event ingestion via HTTP, SDK, and webhook sources
- Stream processing with SQL-defined transformations
- 13-month hot retention; 36-month cold archive at no additional charge
- Unlimited dashboards and saved queries
- Role-based access control with SCIM provisioning
- Audit log export to customer-controlled S3

## 5. Integration effort

SignalForge exposes a REST ingestion API and maintains first-party SDKs for TypeScript,
Python, Go, and Java. Based on the architecture Northstar described, we estimate
**2–3 engineer-weeks** to production for the initial integration, most of which is
instrumenting event emission rather than SignalForge-side configuration.

Our onboarding engineer is assigned for the first 60 days at no charge.

## 6. Support

Growth tier includes our **Priority Support** package:

- Target first response: **2 business hours** for P1, 8 business hours for P2
- Coverage: 07:00–19:00 CET, Monday–Friday
- Named support contact after 90 days
- Quarterly business review

Measured over the last four quarters, our actual median P1 first-response time across the
Growth tier customer base was 47 minutes.

## 7. Commercial terms

| Item | Value |
|---|---|
| Annual platform fee | $20,000 |
| Term | 12 months, auto-renewing |
| Payment terms | Net 30, annual in advance |
| Price protection | Year 1 only |
| Notice period for non-renewal | 60 days |

**Note on renewal pricing:** the $20,000 rate is guaranteed for the initial 12-month term.
Renewal pricing is set annually and reflects platform usage tier, feature adoption, and any
support package changes. We do not commit to a renewal cap in the Growth tier standard
agreement.

## 8. Migration and exit

Northstar retains ownership of all event data. On termination we provide a full export in
Parquet or newline-delimited JSON within 14 days, and retain no copy beyond 30 days.

---

*This proposal is commercial-in-confidence. Figures reflect the Growth tier as of the issue
date and the usage band described in RFP section 2.*
