# Report Structure

## File layout

Write the report as a folder of markdown files, not one giant document. This mirrors how real audit deliverables are organized and lets a team split review work by specialty.

```
<project>-audit/
├── 00-executive-summary.md       (write LAST, after all category reports)
├── 01-recon.md
├── 02-security.md
├── 03-authn-authz.md
├── 04-api-surface.md
├── 05-content-safety.md
├── 06-performance.md
├── 07-accessibility.md
├── 08-seo-best-practices.md
├── 09-ux-cross-platform.md
├── 10-social-platform-risks.md   (skip if not a social/UGC app)
├── 11-observability.md
├── 12-environment-delta.md       (skip if single environment)
├── 13-functional-edge.md
├── 14-network-resilience.md
├── 15-load-test.md
├── evidence/                     (raw curl output, JSON, HTML, Lighthouse reports)
├── screenshots/                  (UX/a11y screenshots if Playwright was used)
└── STATEMENT_OF_WORK.md          (optional — include if the user wants a formal client-facing deliverable)
```

Renumber/omit files to match actual scope — don't ship empty placeholder files for categories that weren't tested. If only security + performance were in scope, the folder is just `00-executive-summary.md`, `01-recon.md`, `02-security.md`, `03-performance.md`.

## Each category file header

```markdown
# [Category Name]

**QA Engineer:** [name or "Claude, on behalf of [user]" if no name given]
**Date:** [date]
**Targets:** [URLs/environments covered in this file]

Format: **ID · Title · Severity · Affected · Repro · Impact · Fix**

---

[findings, using the template in finding-format.md]
```

## Executive Summary structure

This is the single most important file — assume the primary stakeholder reads only this one. Build it last, pulling the highest-impact items across every category.

```markdown
# Executive Summary — [Project] [Audit Type]

**QA Engineer:** [name]
**Date:** [date]
**Targets:** [list]
**Methodology:** [one line — e.g. "Black-box penetration testing, performance profiling, accessibility audit, load testing"]

---

## TL;DR

[2-4 sentences: total finding count by severity, and the 1-3 most severe/urgent issues spelled out in plain language with real numbers.]

---

## Top [N] Must-Fix Before Launch (ranked)

| # | Severity | Finding | Effort | Report |
|---|---|---|---|---|
| 1 | Critical | ... | S/M/L | `02-security.md §S-01` |
...

Rank by severity first, then by effort (cheap fixes for high-severity issues should bubble up — they're the best ROI).

---

## Severity model used

[Copy the rubric table from finding-format.md so the doc is self-contained.]

---

## Scope notes

[Anything that limits interpretation of the findings: what wasn't tested, what was deferred and why, any access limitations.]

---

## Index

- [`01-recon.md`](01-recon.md) — [one-line description]
- [`02-security.md`](02-security.md) — [one-line description]
... (link every file actually produced, with a one-line description of what's in it)
```

## Statement of Work (optional, only if user wants a formal client-facing artifact)

Include when the audit is being delivered to a client/stakeholder as a paid or formal engagement deliverable, not when it's an internal self-check. Covers: project overview, scope table (targets + testing categories with status), deliverables list, methodology/standards applied (e.g. OWASP WSTG, WCAG 2.2 AA, Core Web Vitals thresholds), tools used, findings summary table, timeline, and (if relevant) commercial terms / acceptance signature blocks. Don't fabricate commercial terms (fees, payment terms) — leave them as blanks for the user to fill in, the same way a real consultant would leave placeholders for a client to negotiate.

## Tone

Direct and evidence-led throughout — every claim should be traceable to a specific command, request, or screenshot, not a general impression. Write for an engineering audience: assume technical literacy in the category files, but make the executive summary readable by a non-technical founder/stakeholder. Avoid hedging language ("might possibly be an issue") when you have a direct repro — state findings plainly.
