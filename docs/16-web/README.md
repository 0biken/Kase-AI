# 16 — Web Dashboard

Screens, information architecture, and the display rules that keep trust intact.

---

## 1. Audience split

The dashboard serves two very different readers, and conflating them produces a screen neither uses.

| Reader | Wants | Screen |
|---|---|---|
| Engineering lead | One number, one decision, waiver control | Project overview, gate status |
| Engineer / QA | One finding, its evidence, its patch | Finding detail |

Everything else is navigation between those two.

## 2. Screens

### 2.1 Projects

List with, per project: last audit outcome, gate status, open critical/high counts, trend over the last ten audits, expiring waivers.

The expiring-waiver badge appears here because the person who granted the waiver is rarely the person who will see the red build.

### 2.2 Project overview

```
Acme Web                                    Gate: FAIL

Last audit   aud_01H2X4  ·  full  ·  24m  ·  commit a3f9c1e (verified)
Open         3 critical · 8 high · 21 medium
Trend        criticals over last 10 audits  [sparkline]
Coverage     12/12 required categories
Waivers      1 active · 1 expiring in 9 days
Endpoints    142 known · +3 new this audit · -1 removed
```

The endpoint-drift line comes from the persisted inventory ([06 §2](../06-recon/README.md#2-the-inventory-is-persisted-not-transient)). New endpoints that do not appear in the Code Map are flagged here — they are frequently the most interesting thing in an audit.

### 2.3 Audit detail

Live while running (via SSE), historical afterwards.

- **Header:** mode, status, provenance (with a visible verified/unverified badge), duration, degradation reasons.
- **Job graph:** each job with status, duration, retries. Failed jobs expand to show the error and which category they took down.
- **Budget:** token, wall-clock, and **request-to-target** meters with GREEN/YELLOW/RED state. Requests-to-target is shown as prominently as tokens — it is the number that matters to the customer whose system is being probed.
- **Coverage:** executed vs. not-executed categories, each not-executed with its reason.
- **Findings summary:** by severity and category.

A degraded audit carries a banner at the top, not a footnote. Degradation changes what the findings mean.

### 2.4 Findings list

Filters: severity, category, status, origin, gate-eligible, correlated, has-patch.

Default sort: gate-eligible first, then severity, then confidence band. The things that will block a release sort to the top.

Each row shows severity, title, category, affected target, source location if correlated, and lifecycle status. Non-gate-eligible findings carry a subdued "advisory" marker — visible, not hidden.

### 2.5 Finding detail

The screen the product is judged on.

```
┌────────────────────────────────────────────────────────────┐
│ CRITICAL   IDOR allows invoice access across users         │
│ authz · CWE-639 · fingerprint 8c1f… · open (3 occurrences) │
│ GATE-ELIGIBLE                                              │
├────────────────────────────────────────────────────────────┤
│ REPRODUCTION                              [Replay]         │
│   curl -H "Authorization: Bearer <A>" \                    │
│        https://staging.acme.com/api/invoices/123           │
│   → 200, returns invoice owned by user B                   │
│   Last replay: reproduced · 2026-08-24 11:04               │
├────────────────────────────────────────────────────────────┤
│ SOURCE                                                     │
│   src/invoices/invoice.service.ts · InvoiceService.find    │
│   commit a3f9c1e                                           │
│   Correlation: runtime_dump · verified                     │
│                                                            │
│   82 │ async find(id: string) {                            │
│   83 │   return this.prisma.invoice.findUnique({           │
│   84 │     where: { id }          ← no ownership predicate  │
│   85 │   })                                                │
├────────────────────────────────────────────────────────────┤
│ IMPACT                                                     │
│   Any authenticated user can read any invoice, exposing    │
│   customer billing data.                        [AI]       │
├────────────────────────────────────────────────────────────┤
│ FIX                                       [Copy patch]     │
│   - where: { id }                                          │
│   + where: { id, ownerId: user.id }                        │
├────────────────────────────────────────────────────────────┤
│ EVIDENCE                                                   │
│   EV-124  http_exchange   replayable   [view] [download]   │
│   EV-126  sast_json       replayable   [view]              │
│   EV-131  screenshot      supporting   [view]              │
├────────────────────────────────────────────────────────────┤
│ HISTORY                                                    │
│   aud_01H1  first seen    2026-08-10                       │
│   aud_01H2  open                                           │
│   aud_01H4  open (this audit)                              │
├────────────────────────────────────────────────────────────┤
│ [Create Jira]  [Mark false positive]  [Request waiver]     │
└────────────────────────────────────────────────────────────┘
```

### 2.6 Gate status

The full explainable evaluation: outcome, policy name and version, each blocking finding with the rule that fired and the evidence that supports it, warnings, active waivers with countdowns, coverage, and the commit SHA.

### 2.7 Waivers

Active waivers with expiry countdowns, expired waivers, and the full audit trail: who requested, who approved, reason, affected release. Expiring-soon is the default filter.

### 2.8 Endpoint inventory

Canonical endpoints with discovery source, auth requirement, correlated handler, and drift markers (`new`, `removed`, `changed`) relative to the previous audit.

## 3. Display rules that protect trust

These are product requirements, not styling preferences. Each exists because violating it erodes the credibility the gate depends on.

| Rule | Reason |
|---|---|
| **AI-generated content is labelled `[AI]`** | Root cause, impact summaries, and inferred correlations are interpretation, not observation |
| **Unverified provenance is a visible badge, not a footnote** | It changes whether a source location can be trusted at all |
| **Non-gate-eligible findings are marked, never hidden** | Hiding them makes the tool look wrong when engineers find the issue anyway |
| **Confidence shows as a band, never a percentage** | A number invites arithmetic the value does not support ([09 §7](../09-findings/README.md#7-confidence-is-a-band-not-a-number)) |
| **Degraded audits carry a top-of-page banner** | Findings from a degraded audit are incomplete by definition |
| **Every finding links to raw evidence** | The claim and the proof are never more than one click apart |
| **Passing checks are visible** | "Tested and clean" must be distinguishable from "never tested" |

## 4. Real-time

Running audits stream via SSE from `/audits/:id/events` — job transitions, budget state, findings as they are created. No polling of tools, and no polling of the API from the browser.

Connection loss falls back to a 10-second refresh and shows a stale indicator rather than silently freezing.

## 5. Accessibility

Kase runs accessibility audits. Its own dashboard meets WCAG 2.1 AA, and the axe suite runs against it in CI. Failing that is not survivable for a product in this category.

---

**Next:** [17 — Security Model](../17-security/README.md)
