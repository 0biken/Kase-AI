# Competitor quick scan

Generated 2026-11-25. Internal notes: the GitHub repository is public, so do not commit this file without deciding to publish it.

**How to read this.** "Observed" means a vendor's own page says it. "Not observed" means the pages read do not mention it, which is not proof the feature is missing. Nothing here was tested in a trial. Pages were read through an automated fetch and summary; the Aikido pricing page was truncated. Check any figure at the source before relying on it. No SEO, traffic or review data was collected.

## Closest competitors

| Product | Published price | Tests running app | Reads source | Runtime finding to source line | Blocks CI on results |
|---|---|---|---|---|---|
| Shannon (Keygraph) | Open source (AGPL-3.0), own model costs; Pro $50 per active developer per month | Yes | Yes | Not observed (README says it ties runtime behaviour back to source) | Yes, and only on exploited findings above a severity threshold |
| Snyk | Free; Team from $25 per month; Enterprise by credits, sales quote | Yes | Yes | Yes (February 2026 update) | Not observed on pages read |
| Invicti | Pricing page not read | Yes | Yes | Yes (April 2026), needs a matching DAST and SAST finding | Not observed (CI CLI mentioned) |
| Strix | Open source; Pro $29 per developer per month plus pentest credits | Yes | Yes | Not observed | Yes, non-zero exit when vulnerabilities are found |
| Aikido | Free for 2 users; 300 and 600 per month tiers incl. 10 users; typical pentest $4,000 | Yes | Yes | Not observed | CI gating linked from pricing page |
| StackHawk | Wingman $10 per user per month | Yes | Not observed | Not observed | Reports to CI whether commit is clean |
| Escape | Sales quote | Yes | Not observed as SAST | Not observed | Runs per release; blocking not observed |
| XBOW | Usage-based, sales quote | Yes | Not observed | Not observed | Not observed |

## Adjacent: AI QA testing

mabl, Momentic and QA Wolf sell functional test automation. Evidence here comes only from third-party search results, which conflict on price. mabl is reported to include release-readiness analysis.

## Takeaways (inference)

1. Linking a runtime finding to a line of source is already sold by Snyk and Invicti.
2. Blocking a release only on proven exploits is already offered by Shannon, as open source.
3. "Correlate, then gate on replayable evidence" in one product was not observed in the pages read. This is a narrow gap, and any of the above could close it or may already cover it.
4. Possible differences to verify: binding the tested deployment to the audited commit, PARTIAL as a distinct outcome, waivers with mandatory expiry and separate approver, and non-security QA in the same gate. Competitors were not checked for these.
5. Published self-serve prices seen run from $10 to $50 per developer or user per month, with pentests often billed separately.

## Not checked

Checkmarx, Cycode, OX Security and Bright product pages; SonarQube-style quality gates; GitHub and GitLab built-in security gates; user reviews.

## Sources

- https://github.com/KeygraphHQ/shannon
- https://keygraph.io/pricing
- https://snyk.io/plans/
- https://updates.snyk.io/closing-the-gap-between-code-and-runtime-with-sast-dast-correlation/
- https://www.invicti.com/blog/web-security/dast-to-sast-correlation-fix-verified-runtime-risks-at-pipeline-speed
- https://github.com/usestrix/strix
- https://www.strix.ai/pricing
- https://www.aikido.dev/pricing
- https://www.aikido.dev/attack/aipentest
- https://www.stackhawk.com/pricing/
- https://escape.tech/pricing
- https://xbow.com/pricing
