# Executive Summary — Acme Billing Full Audit

**Reviewer:** Kase, on behalf of Acme Billing
**Date:** 2026-11-26
**Targets:** https://staging.example.com, https://github.com/acme/billing
**Repo/commit reviewed:** `abc1234`
**Methodology:** authz, static\_security (deterministic tools and typed-capability agents)

---

## TL;DR

4 open findings: 2 critical, 1 high, 1 low. Release gate: **FAIL** under policy v3, blocked by 2 findings. Most urgent: SQL built from input (`src/reports/report.repo.ts:17`); Admin route lacks role check (`src/invoices/invoices.service.ts:42`); IDOR on invoices (`src/invoices/invoices.service.ts:42`).

---

## Top 3 Must-Fix Before Launch (ranked)

| # | Severity | Finding | Location | Effort | Report |
|---|---|---|---|---|---|
| 1 | Critical ⛔ | SQL built from input | `src/reports/report.repo.ts:17` | S | `03-security-static-analysis.md §SEC-01` |
| 2 | Critical ⛔ | Admin route lacks role check | `src/invoices/invoices.service.ts:42` | M | `02-authn-authz.md §AUTHZ-01` |
| 3 | High | IDOR on invoices _(waived)_ | `src/invoices/invoices.service.ts:42` | S | `02-authn-authz.md §AUTHZ-02` |

⛔ blocks the release under the evaluated gate policy. Effort is shown only where the fix states it.

---

## Waivers

| Fingerprint | Expires in | Approved by | Reason |
|---|---|---|---|
| `fp-a` | 3d ⚠ | usr\_lead | Fix ships in 1.4 |
| `fp-d` | 20d | usr\_lead | Cosmetic |

⚠ 1 waiver expires within 7 days; the gate will block again when it lapses.

---

## Severity model used

| Severity | Meaning |
|---|---|
| Critical | Exploitable now |

---

## Scope notes

- Not executed: dependencies (timed\_out).
- Accepted risk: Rate limit missing (02-authn-authz.md §AUTHZ-04).

---

## Index

- [`01-scope-and-coverage.md`](01-scope-and-coverage.md) — Scope & Coverage
- [`02-authn-authz.md`](02-authn-authz.md) — Authentication & Authorization
- [`03-security-static-analysis.md`](03-security-static-analysis.md) — Security — Static Analysis
- [`evidence-index.md`](evidence-index.md) — Evidence Index
