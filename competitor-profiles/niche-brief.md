# Niche brief (hypothesis, untested)

Generated 2026-11-25. Internal: the GitHub repository is public, so do not commit without deciding to publish. Competitor detail is in [_summary.md](_summary.md).

## Pick

Fintech and payment teams that ship NestJS or FastAPI APIs through GitHub Actions, fall under PCI DSS, and have no dedicated application security team.

Their job to be done: after a significant change, show an approver or assessor what was tested, what was proven broken, where in the code, who accepted any risk, and for which commit.

## Candidates compared

Ratings are judgement calls from a desk search, not measurements.

| Niche | Reason to buy | Competition seen | Fit with Kase today | Verdict |
|---|---|---|---|---|
| Fintech APIs under PCI DSS | Testing required yearly and after significant change | AI pentest vendors, including Escape | Good: authorization flaws, NestJS and FastAPI, GitHub Actions | Pick, to test |
| SOC 2 SaaS teams | Auditors sample changes | Broad; security testing evidence expectations unclear | Good | Fallback |
| Large regulated finance | Change paperwork | Kosli (Deutsche Bank is a named user and investor) | Poor: enterprise sales and governance are out of v1 scope | Avoid |
| EU Cyber Resilience Act manufacturers | Legal obligations to December 2027 | Not researched | Poor: standalone SaaS is generally reported as out of scope | Avoid |
| Software agencies at handover | Client sign-off | No named tool surfaced in one search | Medium; willingness to pay unknown | Later check |
| Teams shipping AI-written code | Speed | StackHawk, Strix, Shannon | Medium | Avoid |

## Positioning draft

For fintech teams shipping NestJS or FastAPI APIs under PCI DSS, Kase is a release evidence gate: a per-commit record of what was tested, what was proven, where it is in the code, and who accepted the risk.

| Component | Draft |
|---|---|
| Alternatives | Annual pentest plus manual evidence gathering; scanners in CI; AI pentest tools; doing nothing |
| Attributes to prove | Commit-to-deployment provenance; PARTIAL outcome; expiring waivers with separate approver; replayed evidence; source location |
| Value | A release decision that can be explained months later |
| Category | Release evidence, alongside security testing rather than replacing it |

Score: 3 out of 10. No customer interviews, no attribute verified as unique, and the product has not been shown working end to end here. To raise it: interviews, competitor trials, and a passing M5 and M6 run.

## Claims to avoid

- Kase does not replace the PCI DSS penetration test. Requirement 11.4 expects a qualified, organizationally independent tester, and a news report says Council guidance holds that an automated tool alone is not enough. Verify against the standard.
- Do not say competitors lack a feature until it is checked in their docs or a trial.

## Risks

- Escape announced per-release AI pentesting on 19 November 2026.
- Each organization defines "significant change" itself, so urgency may be low.
- Fintech buyers may not trust a young vendor with source code and test credentials. Hosted or self-hosted is still undecided.
- The niche is limited by framework support.

## Interview test

Talk to 10 people who approve or prepare releases at matching companies. Ask about past events, and do not pitch.

1. Walk me through the last significant change you shipped. What had to happen before release?
2. What did your last assessor or approver ask you to show? How did you produce it?
3. How long did that take, and who did it?
4. Has a release been blocked, delayed or questioned over testing? What happened?
5. What do you pay for today for testing and compliance, including the pentest?
6. What have you tried in order to make this easier?

Proposed bar, agreed before the first call:

- At least 5 of 10 assembled release testing evidence by hand in the past six months.
- At least 3 already spend money or significant staff time on it.
- At least 2 commit to a pilot with a named owner and date.

If the bar is missed, switch to the SOC 2 fallback or revisit the buyer.

## Sources

Search summaries, mostly vendor and law-firm pages; none checked against primary standards.

- https://www.kosli.com/
- https://bebeez.eu/2025/03/24/norwegian-startup-raises-e9-2m-to-modernize-compliance-for-financial-institutions/
- https://www.blazeinfosec.com/post/pci-penetration-testing-guide
- https://www.globenewswire.com/news-release/2026/11/19/3406610/0/en/escape-launches-continuous-ai-pentesting-to-test-each-software-release-in-minutes.html
- https://www.techtimes.com/articles/331170/20261120/escape-launches-ai-pentesting-91-catch-rate-no-published-method-pci-says-tools-fall-short.htm
- https://www.dlapiper.com/en/insights/publications/2026/02/cyber-resilience-act-the-fine-line-between-saas-and-digital-products
