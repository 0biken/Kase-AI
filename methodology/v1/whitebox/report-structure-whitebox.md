# Report Structure — White-Box

Same multi-file philosophy as the black-box skill, adapted for source-grounded categories.

## File layout

```
<project>-whitebox-audit/
├── 00-executive-summary.md       (write LAST, after all category reports)
├── 01-code-map.md                (architecture overview — the white-box equivalent of recon)
├── 02-security-static-analysis.md
├── 03-secrets-and-config.md
├── 04-dependency-audit.md
├── 05-authn-authz-logic.md
├── 06-input-validation-error-handling.md
├── 07-code-quality.md            (skip or fold into 06 if scope is security-only)
├── 08-test-coverage.md
├── 09-infra-as-code.md           (skip if no IaC present)
├── evidence/                     (raw tool output: semgrep/bandit/npm-audit JSON, grep results)
└── STATEMENT_OF_WORK.md          (optional — only for formal client-facing delivery)
```

Renumber/omit to match actual scope. A security-only review against a small repo might just be `00-executive-summary.md`, `01-code-map.md`, `02-security-static-analysis.md`, `03-secrets-and-config.md`, `04-dependency-audit.md`.

## 01-code-map.md structure

This replaces recon as the orienting document — instead of "what does the outside world see," it's "how is this system actually built."

```markdown
# Code Map

**Repo/Project:** [name, URL or upload reference]
**Commit/Version reviewed:** [git SHA if available]
**Date:** [date]

## Stack
[Language(s), framework(s), package manager, key dependencies]

## Structure
[Directory layout, monorepo packages if applicable]

## Entry points
[Main server file, route registration, CLI commands]

## Data layer
[ORM/query approach, migration location, notable schema points discovered]

## Auth pattern
[How auth/sessions work, where the permission checks live]

## Third-party integrations
[Payment, email, storage, analytics — and how their credentials are sourced]

## Notable observations
[Anything that shapes how the rest of the review reads — e.g. "two parallel auth systems found," "no centralized validation layer"]
```

## Each finding-category file header

```markdown
# [Category Name]

**Reviewer:** [name or "Claude, on behalf of [user]"]
**Date:** [date]
**Scope:** [files/directories covered in this file, or "full repo"]

Format: **ID · Title · Severity · Location · Root Cause · Impact · Fix**

---

[findings, using the template in finding-format-whitebox.md]
```

## Executive Summary structure

```markdown
# Executive Summary — [Project] White-Box Audit

**Reviewer:** [name]
**Date:** [date]
**Repo/commit reviewed:** [reference]
**Methodology:** [e.g. "Static analysis (semgrep, bandit), manual code review, dependency audit, test coverage review"]

---

## TL;DR

[2-4 sentences: total finding count by severity, the 1-3 most severe issues named with their file:line.]

---

## Top [N] Must-Fix Before Launch/Merge (ranked)

| # | Severity | Finding | Location | Effort | Report |
|---|---|---|---|---|---|
| 1 | Critical | ... | `path:line` | S/M/L | `02-security-static-analysis.md §SEC-01` |
...

---

## Severity model used

[Copy the rubric table from finding-format-whitebox.md.]

---

## Scope notes

[What was/wasn't reviewed, any directories excluded, any tools that couldn't run in this environment.]

---

## Index

[Link every file produced with a one-line description.]
```

## Tone

Same as black-box: direct, evidence-led, technical-audience-default with a non-technical-readable executive summary. The extra advantage here is precision — lean into it. "The `getProfile` handler at `api/routes/profile.ts:34` queries by `id` alone with no `req.user.id` check" is strictly better than "authorization is missing in some places," and white-box review has no excuse for the vaguer version when the file is right there.
