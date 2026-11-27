# Kase: release evidence for small regulated teams

*For advisors and prospective partners. Draft, November 2026.*

## The problem

Small fintech and payment teams ship often, but standards such as PCI DSS expect security testing after significant change, and auditors sample individual changes. Each time, someone has to show what was tested, what was found, what was fixed and who accepted the rest. Today that evidence is usually assembled by hand from scanner output, pentest reports and tickets.

These teams already spend heavily on assurance. Industry estimates put a small company's yearly web application pentest at $8,000–$15,000, and a SOC 2 Type 2 audit at $12,000–$20,000. Compliance platforms cost more on top.

## What Kase does

For every release, Kase runs tests against the live application and reads the source at the exact commit deployed. It links each proven problem to the code that causes it and turns the result into a release decision that CI enforces.

Each decision is kept as an evidence record:
- what was tested and what was proven, with replayable evidence;
- the file and function responsible;
- whether the tested deployment matched the audited commit;
- any accepted risk, with its approver and expiry date.

## Why it's different

- **Evidence decides, AI doesn't.** Only findings with replayable evidence can block a release; AI explains them. An incomplete audit is reported as PARTIAL, never as a pass.
- **Built for small teams.** Existing release-evidence products focus on large regulated enterprises such as banks. Kase is priced and onboarded for teams of 10–80 engineers.
- **Works with existing tools.** Kase adds evidence alongside current tests and compliance platforms. It doesn't replace the independent penetration test PCI DSS requires.

## Who it's for first

Seed to Series B fintech and payment companies building NestJS or FastAPI APIs on GitHub, with no dedicated security team. Next come B2B software companies under SOC 2, and agencies building for regulated clients.

## Business model

Subscription priced per application, not per developer:

| Plan | Price | For |
|---|---|---|
| Community | Free | Advisory gate on one application |
| Team | $499 per application per month | Enforced gate and evidence packs |
| Compliance | From $1,500 per month | Assessor-ready evidence across several applications |

Kase is bootstrapped and designed to be cheap to run, with a target of about 70% gross margin.

## Where we are

The deterministic core is built and verified: audit orchestration, sandboxed workers, hashed evidence storage, recon and finding normalisation. The AI agents, source correlation and release gate are being finished, and with them the full path from finding to blocked pull request. We are now speaking with teams about how they handle release evidence today, before opening design-partner places.

## How you can help

- **Introductions** to CTOs or engineering leads at fintech and payment companies who prepare for PCI DSS or SOC 2.
- **Compliance consultants and fractional CISOs** interested in a referral partnership.
- **Design partners:** five places at 50% off for the first year, in exchange for a weekly call and a case study.

Contact: via the waitlist at the Kase site.
