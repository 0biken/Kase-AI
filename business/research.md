# Kase business research

Collected 2026-11-25 to 2026-11-26. Internal; the repository is public, so do not commit without deciding to publish.

**Source labels.** *Vendor*: the seller's own page. *Third party*: analyst, blog or aggregator. *Search*: taken from a search-result summary because the page was not opened. Market-size reports are paid syndicated estimates with unclear methods; use them as ranges, never as facts.

## 1. Market size

| Market | Estimate | Source | Label |
|---|---|---|---|
| Application security | About $13.6B in 2026, about 11.5% yearly growth to 2031 | [MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/application-security-market-110170194.html) | Third party, search |
| DAST | $2.8B (2025) to $4.5B (2026) across 4 reports; 15–21% yearly growth | [Mordor](https://www.mordorintelligence.com/industry-reports/dynamic-application-security-testing-market), [Research and Markets](https://www.researchandmarkets.com/report/dynamic-application-security-testing), [Spherical Insights](https://www.sphericalinsights.com/blogs/world-s-top-20-companies-in-dynamic-application-security-testing-dast-market-2025-industry-intelligence-report-by-spherical-insights-2026-2035) | Third party, search |
| ASPM (aggregating security tool results) | About $2.55B in 2026, about 20.6% yearly growth to 2031 | [Mordor](https://www.mordorintelligence.com/industry-reports/application-security-posture-management-market) | Third party, search |
| Fintech startups worldwide | About 30,000; no stage breakdown found | [DemandSage](https://www.demandsage.com/fintech-startups-statistics/) | Third party, weak |
| Payments share of top fintechs | 115 of the CNBC/Statista top 500 (23%) | [CNBC](https://www.cnbc.com/worlds-top-fintech-companies-2026/) | Third party, search |

**Planning note:** the market is clearly large enough. For a bootstrapped company the binding limit is how many buyers can be reached, not market size. A count of seed to Series B fintechs on NestJS or FastAPI needs a database such as Crunchbase or Dealroom, which was not checked.

**ASPM caution:** a [2026 Latio report](https://www.legitsecurity.com/hubfs/2026-Latio-Application-Security-Report.pdf) says standalone "management without scanning" has largely collapsed into broader vulnerability management. This weakens a pure aggregation play (direction A in section 5).

## 2. What buyers already spend

| Item | Range | Source | Label |
|---|---|---|---|
| Web app penetration test, small company | $8,000–$15,000 per year; $5,000–$30,000 typical range | [Astra](https://www.getastra.com/blog/penetration-testing/cost/), [Synack](https://www.synack.com/?p=27316) | Pentest vendors, search |
| Small SaaS with APIs and roles, pentest | $15,000–$20,000+ | [Compass IT](https://www.compassitc.com/blog/how-much-does-a-penetration-test-cost-for-a-small-business) | Vendor, search |
| AI pentest, typical assessment | $4,000 per assessment | [Aikido pricing](https://www.aikido.dev/pricing) | Vendor, read 2026-11-25 |
| Vanta, smallest package | From $14,000 per 12 months, 1–20 employees (AWS Marketplace) | [SecureLeap](https://www.secureleap.tech/blog/vanta-review-pricing-top-alternatives-for-compliance-automation) | Third party citing vendor listing |
| Drata, startup tier | $7,500–$15,000 per year | [soc2auditors.org](https://soc2auditors.org/insights/soc-2-software-pricing-comparison/) | Third party |
| SOC 2 audit fee, small company | Type 1 $7,500–$15,000; Type 2 $12,000–$20,000 | [soc2auditors.org](https://soc2auditors.org/insights/soc-2-software-pricing-comparison/) | Third party |
| PCI DSS QSA assessment, Level 1 | $25,000–$100,000+ per year | [Scrut](https://www.scrut.io/post/calculating-your-actual-pci-compliance-cost-expert-guide-for-2026) | Vendor blog, search |
| PCI DSS, small merchant (Level 4) | $5,000–$25,000 per year | [SecurityMetrics](https://www.securitymetrics.com/blog/how-much-does-pci-compliance-cost) | Vendor blog, search |

**Reading:** a small fintech under SOC 2 and PCI DSS plausibly spends **$30,000–$60,000 a year** on pentests, a compliance platform and audits (inference from the ranges above). Kase at about $6,000 per application per year would be 10–20% of that budget.

## 3. Competitor prices

Read on vendor pages 2026-11-25 unless marked; full detail in [../competitor-profiles/_summary.md](../competitor-profiles/_summary.md).

| Vendor | Published price | Unit |
|---|---|---|
| StackHawk Wingman | $10 per user per month | User |
| Snyk Team | From $25 per month, up to 10 developers | Developer |
| Strix Pro | $29 per developer per month, pentests $100–$300 extra | Developer plus credits |
| Keygraph Pro (Shannon) | $50 per active developer per month; open source free | Developer |
| Aikido | Free for 2 users; 300 and 600 per month incl. 10 users | Tier plus credits |
| Kosli | No public price; annual contracts priced by recorded data volume and retention; capped for the term (read 2026-11-26) | Data volume |
| XBOW, Escape, Invicti | Sales quote | — |

**Key fact:** Vanta partners with XBOW for in-app pentesting. Per a search result, Plus and Growth customers with up to 750 employees receive one free pentest a year, subject to coverage limits ([Vanta help](https://help.vanta.com/en/articles/12511387-vanta-x-bow-ai-powered-penetration-testing-public-preview); page returned 404 on 2026-11-26, so unverified). Compliance platforms are absorbing the yearly pentest. Kase must not sell "a cheaper pentest".

**Integration fact:** Cobalt, BreachLock and Pentest-Tools.com push pentest findings into Vanta ([BreachLock](https://www.breachlock.com/?p=15859), [Pentest-Tools](https://pentest-tools.com/docs/capabilities/integrations/vanta)). An evidence integration with Vanta and Drata is a proven channel pattern.

## 4. Kase's cost to serve

**Token budget**, from [docs/11-ai-layer/README.md](../docs/11-ai-layer/README.md) section 5: a full audit is capped at 2,000,000 tokens and 120 agent calls, with prompt caching of the methodology, system prompt and code map.

**Model prices**, per million tokens from the Anthropic price table cached 2026-11-03. Prices for OpenAI and Gemini, which Kase also supports, were not checked.

| Model | Input | Output | Cached input read |
|---|---|---|---|
| Claude Opus 5.5 | $4.00 | $20.00 | $0.20 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $0.10 |
| Claude Haiku 5.5 | $0.10 | $0.50 | Not listed |

**Worked estimate (hypothesis).** Assume a full audit uses its whole 2M-token budget: 90% input, 70% of that input from cache, and 10% output.

| Model | Approximate cost per full audit |
|---|---|
| Sonnet 5.5 | About $3.20 |
| Opus 5.5 | About $6.40 |

The estimate ignores cache-write premiums and retries. The [Keygraph benchmark](https://keygraph.io/shannon-benchmark) reports one Shannon run costing $115 (vendor claim), so real agentic runs can cost far more than a budget-capped estimate. Treat $5–$30 per full audit as the planning range until measured.

## 5. Bolder directions: evidence

| Direction | For | Against |
|---|---|---|
| A. Evidence and gate layer over other tools | Turns Snyk, Semgrep and Shannon into inputs, not rivals; Kosli shows buyers pay for release evidence | Standalone ASPM reportedly collapsing; Kosli and ASPM vendors are closer to it; Kase's correlation edge matters less if it only ingests |
| B. Assurance for AI-written code | Fast-growing need | StackHawk, Strix and Shannon already target it at $10–$50 per developer |
| C. Compliance-platform partnership | Proven integration pattern; buyers already pay $15,000+ for Vanta or Drata | Vanta bundles XBOW pentests; as a sole strategy it makes Kase a feature inside someone else's product |

## 6. Gaps not closed

- Count of reachable seed to Series B fintechs on the supported stack.
- Invicti, Escape and XBOW prices.
- Real cost per audit on the fixture or a real repository.
- Primary PCI DSS wording on automated testing and "significant change".
