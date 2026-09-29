# Finding Format & Severity Rubric

Every finding in every category report follows this structure. This is non-negotiable — a finding without a fix is just a complaint, and the entire value of this audit style is that it converts directly into engineering tickets.

## Template

```markdown
## [ID] · [Short title] — **[SEVERITY]**

- **CWE-XXX** (CWE name) — *only for security findings; omit for perf/a11y/UX*
- **Affected:** [exact URL, endpoint, component, or table]
- [1-3 sentences of context: what's misconfigured/broken and why it matters technically]

**Repro:**
```
[exact command, request, or steps — something another engineer could copy-paste and reproduce immediately]
```

**Impact:**
[Concrete consequence in business/user terms, not just technical terms. Quantify when possible — "217 user profiles enumerable" beats "user data exposed."]

**Fix:**
[Specific, actionable remediation. Prefer:
- Actual code/config snippet they can paste
- Named library, service, or setting
- Ordered steps if multi-part
- An effort estimate tag: S (hours), M (a day or two), L (architectural/multi-day)]
```

For passing checks (things tested and found fine), still log them — `**PASS** ✅` — with a one-line note on what was verified. This shows audit thoroughness and prevents the client from re-asking "did you check X."

## Severity rubric

Apply consistently across every category — a "Critical" in accessibility and a "Critical" in security should both mean "this blocks launch," even though the underlying harm differs.

| Severity | Definition | Examples |
|---|---|---|
| **Critical** | Exploitable/observable today, with no special access required, causing data exposure, full takeover, or the product being fundamentally unusable for a real segment of users | Auth bypass, mass data exposure via missing access control, server crashes under realistic load, core flow completely broken |
| **High** | Exploitable or impactful with low effort, or affecting a large share of users/use cases; reputational, compliance, or moderate data/UX impact | Missing security headers, open CORS, no compression causing multi-second load times, WCAG failures blocking screen-reader users from a core flow |
| **Medium** | Real risk or real degradation but requires specific conditions (particular user state, specific browser, social engineering, edge-case input) | Tech stack fingerprint leakage, contrast issues in dark mode only, host header not validated |
| **Low / Info** | Hygiene, defense-in-depth, or best-practice gaps with minimal direct exploitability | Missing security.txt, non-standard HTTP status code on an unusual method, missing robots.txt |

When uncertain between two severities, ask: "If this were the only finding in the report, would it alone justify delaying launch?" If yes, it's Critical or High. If the answer is "only combined with other issues," it's Medium or below.

## Effort tags for fixes

Use these consistently so the executive summary's "must-fix" table is sortable by effort vs. impact:

- **S (Small):** Config change, single header, one-line code fix, hours of work
- **M (Medium):** New code path, a script, a day or two of focused work
- **L (Large):** Architectural decision, infrastructure migration, multi-day/sprint effort

## Writing impact statements that land

Compare:
- Weak: "This could be a security risk."
- Strong: "Anyone with a browser can scrape the entire pre-launch testimony corpus — 74 posts, 217 author profiles including emails and admin roles. This is the exact data the platform exists to protect."

The strong version names the actual numbers, the actual data, and ties it back to what the product is for. Pull real counts, real endpoint names, real response bodies from your testing — don't generalize when you have the specifics in front of you.

## Cross-referencing

When a finding in one category report is the underlying cause of an issue mentioned in another (e.g. a missing CORS header discussed in the security report also explains an API surface issue), cross-reference by file and ID (`see 02-security.md §S-05`) rather than re-explaining it. Keeps each report focused and avoids drift between two descriptions of the same root cause.
