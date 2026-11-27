# Kase business proposal

Draft, 2026-11-26. Internal: the GitHub repository is public, so decide before committing this. Every number below is a starting hypothesis to test, not a measurement. Competitor evidence is in [../competitor-profiles/_summary.md](../competitor-profiles/_summary.md); the niche reasoning is in [../competitor-profiles/niche-brief.md](../competitor-profiles/niche-brief.md).

## 1. The bet in one paragraph

Stronger competitors already sell AI penetration testing (Escape, XBOW, Aikido), linking a runtime finding to code (Snyk, Invicti) and open-source exploit gating (Shannon, Strix). Kase should not compete as "a better scanner". It should sell the **release evidence record**: for each commit, what was tested, what was proven, where it lives in the code, which deployment it ran against, and who accepted any remaining risk. The first buyers are small fintech and payment teams who must show that evidence to an approver or assessor and today assemble it by hand.

## 2. Customers

| Tier | Who | Trigger to buy | Buyer / champion |
|---|---|---|---|
| Primary | Seed to Series B fintech and payments, 10–80 engineers, NestJS or FastAPI, GitHub, no AppSec team | PCI DSS testing after significant change; fear of authorization (IDOR) incidents | CTO or head of engineering / platform engineer |
| Secondary | Series A–C B2B software under SOC 2, 20–200 engineers, same stack | Auditor change sampling; enterprise security questionnaires | VP engineering or first security hire / engineer who prepares audits |
| Tertiary | Agencies, 15–150 people, building for regulated clients | Client sign-off at handover; liability | Founder or delivery lead; also a channel into client projects |

Not now: large banks (Kosli, procurement), Express/Django/Rails/Java backends (no correlation support), buyers who only want the cheapest pentest.

## 3. Validate before charging (Mom Test)

The product is not finished, which is fine: interviews need no product.

**Outreach (no pitch):**
> I'm researching how small fintech teams handle security testing and sign-off for releases. You've clearly dealt with this at [company]. Could I ask you about your last release for 20 minutes? I'm not selling anything.

**Questions** (past behaviour only):
1. Walk me through the last significant change you shipped. What had to happen before release?
2. What did your last assessor, auditor or approver ask to see? How did you produce it?
3. How long did that take, and who did it?
4. When was a release blocked, delayed or questioned over testing? What happened next?
5. What do you pay today for testing and compliance, including pentests and consultants? Whose budget is it?
6. What have you tried to make this easier, and why did you stop?

Never ask "would you use" or "how much would you pay". Deflect compliments back to facts.

**Commitment to ask for at the end**, in order of strength: an introduction to a peer or the compliance owner; a 30-minute look at their current evidence folder; a paid design-partner pilot.

**Bar to continue** (agree it before the first call): of 10 interviews, at least 5 assembled release testing evidence by hand in the last six months, at least 3 already spend money or significant staff time on it, at least 2 commit to a pilot with a named owner and date. Miss it: rerun with the SOC 2 group before building more.

Log every call in one sheet: who, date, facts, quotes, commitment, belief changed.

## 4. Pricing and packaging

### Billing unit: per application, not per developer

An application is one target URL plus its repository. Reasons:

- Competitors price per developer ($10–$50 per month). Pricing per application avoids a direct line-by-line comparison and matches what Kase actually produces: evidence per release of one system.
- Small fintech teams have few applications and many developers, so this is easier to approve.
- Cost to serve scales with audits per application, not seats.

### Plans (starting hypotheses)

| Plan | Price | For | Includes |
|---|---|---|---|
| Community | Free | Trying it, open-source projects | 1 application; gate in **advisory mode** (reports, never blocks); smoke and regression audits; 7-day evidence retention |
| Team | $499 per application per month, annual; $599 monthly | Primary tier | Gate **enforced** in CI with PASS / FAIL / PARTIAL; evidence pack export per release; waivers with expiry and separate approver; 4 full audits per month plus unlimited smoke and regression; 90-day retention; GitHub checks; Jira |
| Compliance | From $1,500 per month (3 applications), annual, sales-led | Teams facing an assessor | Everything in Team; assessor-ready evidence pack mapped to the customer's own "significant change" definition; 12-month retention; extra full audits; priority support; self-hosted option later |
| Design partner | 50% off Team for 12 months, or a $1,000 60-day paid pilot credited to the first year | First 5 customers | Weekly call, named case study, input on roadmap |

Context for buyers: a single typical AI pentest assessment is listed at $4,000 by Aikido; Team at about $6,000 a year covers every release of one application. Kase does **not** replace the PCI DSS penetration test; never price or market it as if it does.

### The paywall

Free users see value first: a real finding, with replayed evidence and its source location, on their own repository. The upgrade moment is the first time they want to **act on it as a gate or show it to someone**:

| Trigger | Free behaviour | Paid unlock |
|---|---|---|
| Gate would have failed a PR | Advisory comment: "This release would have been blocked: 1 critical, reproduced" | Enforce the gate |
| User clicks "Export evidence pack" | Preview of the first page | Full pack |
| User tries to accept a risk | Explains waivers need an approver and expiry | Waivers |
| Evidence older than 7 days | Tombstone with "kept 90 days on Team" | Longer retention |
| Second application | Explains the 1-application limit | Add an application |

Rules: never block a running audit or hide a finding behind the paywall (hiding security findings destroys trust); always a visible "continue free"; at most one prompt per session, with days of cool-down after dismissal.

### Unit economics guard

LLM cost per audit is not yet measured. Keygraph reports one Shannon run cost $115 in model tokens, so full agentic audits may be expensive. Target at least 70% gross margin: on Team at $499, total cost to serve must stay under about $150 per application per month. Before publishing prices:

1. Measure cost per smoke, security, full and regression audit on the fixture and on design-partner repositories (the AI layer already tracks this metric).
2. Set the included full-audit allowance from that number.
3. Keep smoke and regression deterministic or cheap so they can stay unlimited.

## 5. Go-to-market and growth

### Months 0–6: founder-led sales

The first 10 customers come from conversations, not marketing. Sources: personal network, fintech founder communities, NestJS and FastAPI communities, and compliance consultants.

### Channels (owned, rented, borrowed)

| Type | Channel | Purpose |
|---|---|---|
| Owned | Waitlist on the landing page (already built) | Capture every lead; segment by role and stack |
| Owned | Short writing on release evidence: "How to define a significant change", "What an assessor asks for", "Anatomy of an IDOR from request to source line" | Search and credibility with the primary tier |
| Owned | Free GitHub Action in advisory mode | Product-led entry; every PR comment is a reminder of value |
| Rented | LinkedIn for fintech engineering leaders; NestJS and FastAPI forums and Discords | Drive to waitlist and Action |
| Borrowed | PCI and SOC 2 consultants, fractional CISOs, compliance automation vendors | Referral partners; offer a revenue share (for example 15–20% of first-year revenue) |
| Borrowed | Agencies (tertiary tier) | Resell or bundle Kase into client delivery |
| Borrowed | Talks and podcasts on authorization bugs | Reach security-minded engineers |

### Growth loops to design in

- **Evidence pack loop:** each pack a customer sends to an assessor, auditor or enterprise customer carries "Produced with Kase". The people who receive packs are future buyers.
- **Advisory-to-enforce loop:** free advisory comments show "would have blocked" counts over time; enforcing is the natural upgrade.
- **Agency loop:** one agency adds Kase to several client projects.

### Retention

Retention comes from becoming part of the release process: the gate in CI, waivers that expire and need renewal, and history that is costly to lose. Track whether teams disable the gate; the roadmap already names "nobody disabled the gate" as the real success criterion.

## 6. Launch plan

**Readiness gate:** Kase is not yet Simple, Lovable and Complete. M4 is open, and M5 and M6 are not fully checked off in TASKS.md. The launchable version should be one thing done fully: the NestJS/FastAPI authorization finding, correlated, replayed, gating a GitHub PR, with an exportable evidence pack. Cut everything else from the first launch.

| Phase | Trigger | Actions | Exit |
|---|---|---|---|
| 0. Discovery | Now | 10 interviews; waitlist live with the intake webhook configured | Section 3 bar met |
| 1. Internal | Vertical slice passes on the fixture | Run Kase on your own and friendly repos; measure cost per audit | Costs known; pricing allowance set |
| 2. Alpha | Slice works on a real external repository | 3–5 design partners, onboarded one by one by you | 2 partners use the gate on real PRs for 4 weeks |
| 3. Beta | Partners keep the gate on | Paid pilots; first evidence packs shown to a real assessor or auditor; first case study | 5 paying; at least one pack accepted |
| 4. Early access | Onboarding works without you | Open the waitlist in batches; publish writing; partner referrals | Self-serve activation without help |
| 5. Launch | Public | Free GitHub Action, pricing page, Show HN, Product Hunt, community posts, comparison pages | Steady self-serve signups |

## 7. Twelve-month targets (illustrative)

| By | Target |
|---|---|
| Month 2 | 10 interviews logged; go / no-go on primary tier |
| Month 6 | 5 design partners, at least 2 paying |
| Month 9 | 10 paying customers; one public case study; cost per audit known |
| Month 12 | About 15–20 paying applications, roughly $90k–$120k annual recurring revenue at Team pricing; under 5% monthly logo churn |

Leading indicators: free-to-paid conversion after the first "would have blocked" event; percentage of teams with the gate enforced after 30 days; time from sign-in to first finding.

## 8. Decisions needed from the founders

1. **Hosted, self-hosted or both.** Fintech buyers may require self-hosting; it slows the start.
2. **Licence.** The repository is public without a licence. Options: keep closed and make it private; open-core (open the CLI, Action and correlation spike, keep the platform closed); or source-available. Open-core fits the free advisory tier and competes with Shannon and Strix on their own ground.
3. **Who sells.** Someone must own interviews and pilots each week.
4. **Funding path.** Bootstrapped favours the paid-pilot path; raising favours speed to design partners.
5. **Compliance claims.** Have the PCI wording reviewed before any marketing mentions PCI DSS.

## 9. Biggest risks

| Risk | Response |
|---|---|
| A funded competitor adds release evidence records | Move fast on the narrow niche; depth on authorization flaws and provenance |
| Pain is mild because "significant change" is self-defined | Interview bar decides; fall back to SOC 2 |
| LLM cost exceeds price | Measure first; allowances; deterministic modes unlimited |
| Buyers won't trust a young vendor with code and credentials | Self-hosted option, security page, short credential lifetimes, design-partner references |
| Product not finished | Launch plan gated on the vertical slice, not dates |

## Sources

- Competitor pages and pricing: see [../competitor-profiles/_summary.md](../competitor-profiles/_summary.md)
- Keygraph Shannon run cost: https://keygraph.io/shannon-benchmark (vendor claim)
- Aikido typical pentest price: https://www.aikido.dev/pricing
- PCI DSS testing after significant change: https://www.blazeinfosec.com/post/pci-penetration-testing-guide
- Escape per-release pentesting launch: https://www.globenewswire.com/news-release/2026/11/19/3406610/0/en/escape-launches-continuous-ai-pentesting-to-test-each-software-release-in-minutes.html
