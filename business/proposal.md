# Kase business proposal, v2

Draft 2026-11-26, internal. Bootstrapped. Numbers come from [research.md](research.md) or [financial-model.xlsx](financial-model.xlsx); everything else is a hypothesis. Version 1 is kept in [proposal-v1.md](proposal-v1.md). The repository is public, so do not commit without deciding to publish.

## 1. The bet

**Position:** the release evidence record for small regulated software teams. For every commit it records what was tested, what was proven broken, where in the code, which deployment it ran against, and who accepted the remaining risk.

**Beachhead:** fintech and payment teams, seed to Series B, building NestJS or FastAPI APIs on GitHub, with no dedicated security team.

**Why this and not a better scanner:**
- **Testing is getting commoditised.** AI pentests already sell for $100–$4,000 (Strix, Aikido), and Vanta reportedly bundles a free XBOW pentest a year.
- **Release evidence is not.** Kosli proves buyers pay for release evidence, but it sells annual enterprise contracts to banks. Nobody observed serves small teams with evidence and built-in testing together.
- **Kase works alongside stronger tools.** It does not try to beat Snyk or Escape at finding bugs, and its own correlation and replay make its evidence stronger than a collection of imported results.

### Directions considered

| Direction | Bootstrap fit | Competition | Fit today | Reachable buyers | Verdict |
|---|---|---|---|---|---|
| Fintech release evidence (beachhead) | Good: paid pilots early | Medium | Good | Medium | **Start here** |
| A. Evidence and gate layer over all tools | Medium | High (ASPM, Kosli) | Medium | High | **Long-term position**, entered via imports of Snyk, Semgrep and Shannon results |
| B. Assurance for AI-written code | Poor: $10–$50 per developer price war | Very high | Medium | High | Avoid |
| C. Compliance-platform partnership | Good as a channel | Vanta already bundles pentests | Good | High | **Use as a channel**, not the strategy |

## 2. Customers

| Tier | Who | Trigger | Buyer |
|---|---|---|---|
| Primary | Fintech and payments, 10–80 engineers | PCI DSS testing after significant change; authorization incidents | CTO or head of engineering |
| Secondary | B2B software under SOC 2, 20–200 engineers | Auditor change sampling; security questionnaires | VP engineering or first security hire |
| Tertiary | Agencies building for regulated clients | Client sign-off at handover | Founder or delivery lead; also a reseller channel |

Avoid for now: large banks, unsupported stacks (Express, Django, Rails, Java), and buyers shopping only on pentest price.

**Budget context:** a small fintech under SOC 2 and PCI DSS plausibly spends $30,000–$60,000 a year on pentests, a compliance platform and audits (research.md section 2). Kase Team at about $6,000 per application per year would be 10–20% of that.

## 3. Validate first: 10 conversations

The product isn't finished, which doesn't matter here: these conversations need no demo.

**Ask about the past, never the idea:**
1. Walk me through the last significant change you shipped. What had to happen before release?
2. What did your assessor, auditor or approver ask to see? How did you produce it?
3. How long did that take, and who did it?
4. When was a release blocked, delayed or questioned over testing? What happened?
5. What do you pay today for testing and compliance? Whose budget is it?

**Close with an ask:** an introduction to the compliance owner, a look at their evidence folder, or a paid pilot.

**Bar to continue:**
- at least 5 of 10 assembled release evidence by hand in the last six months;
- at least 3 already spend money or significant time on it;
- at least 2 commit to a pilot with an owner and a date.

If you miss the bar, rerun the questions with SOC 2 teams before building more.

## 4. Pricing and paywall

Price **per application** (one target plus its repository), not per developer. Competitors charge $10–$50 per developer; pricing per application avoids that comparison and tracks Kase's cost.

| Plan | Price | What it unlocks |
|---|---|---|
| Community | Free | 1 application, gate in advisory mode (reports, never blocks), smoke and regression audits, 7-day evidence |
| Team | $499 per application per month, billed annually | Enforced gate (PASS / FAIL / PARTIAL), evidence pack per release, expiring waivers with a separate approver, 4 full audits a month, 90-day evidence, GitHub, Jira, Vanta and Drata export |
| Compliance | From $1,500 per month for 3 applications | Assessor-ready packs mapped to the customer's own "significant change" definition, 12-month evidence, more full audits, priority support |
| Design partner | 50% off Team until 12 months after launch | Weekly call, case study |

**Upgrade moments** (value first, never hide a finding):
- A pull request would have been blocked: an advisory comment says so, and the upgrade enforces the gate.
- Someone exports an evidence pack: they get a preview, and the full pack is paid.
- Someone accepts a risk: waivers are paid.
- Evidence reaches 7 days old: it becomes a tombstone that says how long Team keeps it.
- Someone adds a second application.

**Pricing guardrail from the model:** Team costs about $150 per application per month to serve, a 70% margin at $499. The floor for 70% is about $498, so **don't discount Team below about $500 until cost per audit is measured**. If a full audit costs twice the estimate and the price drops to $299, margin falls to about 39%.

## 5. Money (base scenario, financial model)

| Measure | Value |
|---|---|
| Cost per full audit (Sonnet 5.5, 3x overrun allowance) | About $9.60 |
| AI cost per Team application per month | About $87 |
| Gross margin, Team | About 70% |
| Paying applications to cover fixed costs ($1,050 per month) | 3 |
| Paying applications to also pay founders $10,000 a month in total | About 32 |
| Month 12 | About 12 paying applications, about $4,700 MRR |
| Month 24 | About 47 paying applications, about $23,600 MRR (about $284,000 run rate) |
| First month with positive cash flow after launch | Month 10 |
| Extra cash needed beyond $15,000 starting cash | None, but only because founders are unpaid |

**Scenarios at month 24:**
- Conservative: about $50,000 run rate, founders still unpaid.
- Base: about $284,000.
- Optimistic: about $1.2M.

**What this means for bootstrapping:**
- Kase is cheap to run, so the real cost is founder time.
- The base case reaches founder pay only around month 20.
- Speed matters more than margin. Paid pilots, consulting-style onboarding fees, or one founder's outside income may be needed to bridge the gap.

The weakest inputs are cost per audit, lead volume and conversion. Measure them first.

## 6. Growth and launch

**Channels**, in order:
1. **Founder-led sales** to the first 10 customers: your network, fintech founder communities, NestJS and FastAPI communities.
2. **Compliance consultants and fractional CISOs** as referral partners, paid a 15% revenue share.
3. **Vanta and Drata evidence export.** Cobalt and BreachLock already push results into Vanta, so the pattern is proven.
4. **A free GitHub Action in advisory mode.** Each "would have blocked" comment advertises the paid tier.
5. **Practical writing:** "How to define a significant change", "What your assessor asks for", "One IDOR from request to source line".
6. **Agencies** as resellers.

**Loops:**
- Evidence packs sent to auditors and enterprise customers carry the Kase name.
- Advisory comments lead to enforcing the gate.
- One agency brings in several client projects.

**Launch phases**, each triggered by a milestone, not a date:

| Phase | Trigger | Exit |
|---|---|---|
| 0. Discovery | Now | Interview bar met |
| 1. Internal | Vertical slice passes on the fixture | Cost per audit measured; prices confirmed |
| 2. Design partners | Slice works on a real external repo | 2 partners gating real PRs for 4 weeks |
| 3. Paid beta | Partners keep the gate on | 5 paying; one evidence pack accepted by a real assessor or auditor |
| 4. Public launch | Onboarding works without you (model month 9) | Free Action, pricing page, Show HN, Product Hunt, comparison pages |

**Launch scope:** one complete flow. An authorization flaw is found, correlated to source, replayed, blocks a GitHub PR and is exported as an evidence pack. Everything else waits.

## 7. Decisions and risks

**Decisions for the founders:**
1. Hosted only at first, or offer self-hosting for fintech buyers.
2. Licence. The repo is public without one. Open-core, with the CLI and Action open and the platform closed, fits the free tier.
3. Who runs the weekly interviews and pilots.
4. How founders are paid until about 32 applications.
5. Legal review of any PCI DSS wording before marketing.

**Top risks:**

| Risk | Response |
|---|---|
| A funded rival adds small-team release evidence | Speed in the niche; depth in provenance, replay and waivers |
| The pain is mild because "significant change" is self-defined | The interview bar decides; fall back to SOC 2 |
| Cost per audit is far above $10 | Measure in phase 1; keep smoke and regression cheap; full-audit allowance |
| Buyers won't hand code and credentials to a young vendor | Self-hosted option, short-lived credentials, design-partner references |
| Overclaiming compliance | Never say Kase replaces the PCI DSS penetration test |
