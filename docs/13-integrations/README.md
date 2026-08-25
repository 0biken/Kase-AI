# 13 — Integrations

GitHub, GitHub Actions, Jira.

---

## 1. GitHub

### Connection

GitHub App (not a PAT). Requested permissions, minimum viable:

| Permission | Level | Why |
|---|---|---|
| Contents | Read | Clone at the audit commit |
| Metadata | Read | Repository info |
| Pull requests | Read & write | Post the audit summary comment |
| Checks | Read & write | Publish the gate as a check run |
| Commit statuses | Read | Provenance corroboration |

Installation tokens are short-lived and resolved per job. No long-lived repository credential is stored.

### Checkout

```
resolve BuildProvenance.commitSha
  -> git clone --filter=blob:none <repo>
  -> git checkout <sha>
```

Partial clone keeps large repositories cheap. Full history is fetched only when secret scanning is enabled, since gitleaks needs commit history.

### PR comment

One comment per audit, **updated in place** rather than appended, so a PR with six pushes has one comment and not six.

```markdown
## Kase audit — FAIL

**Commit** `a3f9c1e` · **Mode** full · **Duration** 24m · [Full report](https://...)

### Blocking (2)
| Severity | Finding | Location |
|---|---|---|
| Critical | IDOR allows invoice access across users | `src/invoices/invoice.service.ts` · `InvoiceService.find` |
| High | Hardcoded API key in source | `src/config/stripe.ts` · `stripeConfig` |

### Warnings (5)
3 findings with AI-inferred correlation · 2 high-severity without replayable evidence

### Waivers
1 active waiver expires in 9 days (`2b7e...`, approved by alex@example.com)

<sub>Coverage: 12/12 required categories executed · Not degraded</sub>
```

Blocking findings link to evidence and, where a patch exists, show the diff inline.

### Check run

The gate is published as a GitHub check run so branch protection can require it.

| Gate outcome | Check conclusion |
|---|---|
| PASS | `success` |
| FAIL | `failure` |
| PARTIAL | `neutral` by default; `failure` if the project treats partial as blocking |

Annotations are attached at `file:line` for findings with verified source locations. Unverified correlations are **not** annotated — a wrong inline annotation on a PR is worse than none.

## 2. GitHub Actions

### Workflow

```yaml
name: Kase audit
on:
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Optional but strongly recommended: emit a runtime route map.
      # This is what upgrades correlation from inference to ground truth.
      - run: npx kase-routemap --framework nestjs --out .kase/routes.json

      - uses: kase/audit-action@v1
        with:
          api-token: ${{ secrets.KASE_TOKEN }}
          project: acme-web
          target: staging
          mode: full
          commit: ${{ github.sha }}      # supplies verified BuildProvenance
          route-map: .kase/routes.json
          fail-on: fail,partial
```

`commit:` is what gives `BuildProvenance.source = 'ci_supplied'` and `verified: true`. Without it the audit falls back to `assumed` and every correlated finding becomes non-gate-eligible. The action warns loudly when it is omitted.

### Deployment ordering

For a PR audit, the target must be running the PR's build. Two supported patterns:

| Pattern | How |
|---|---|
| Preview deploy | Audit job `needs:` the deploy job; target URL passed as an input |
| Post-deploy | Audit runs on `deployment_status: success` |

Auditing a static staging URL from a PR pipeline is the most common way teams accidentally produce unverified provenance.

### Action outputs

```yaml
outputs:
  outcome:            # pass | fail | partial
  audit-id:
  report-url:
  blocking-count:
  critical-count:
  degraded:           # true | false
```

Exit codes match the CLI ([15 §3](../15-cli/README.md#3-exit-codes)).

## 3. Jira

### Connection

Jira Cloud via OAuth 2.0 (3LO). Stored credential is encrypted per [02 §4](../02-stack/README.md#4-secrets-management-is-a-first-class-requirement).

Project configuration:

```ts
JiraConfig {
  projectKey: string
  issueType: string              // 'Bug'
  severityFieldMapping: Record<Severity, string>
  autoCreateFrom: Severity       // e.g. 'high' — nothing below is auto-created
  labels: string[]
  componentByCategory: Record<string, string>
}
```

### Issue creation

Manual from the findings view, or automatic above a severity threshold.

The issue carries the full finding — severity, reproduction, impact, remediation, source location, evidence links, and the Kase audit link. A Jira ticket that says "see Kase for details" wastes the integration.

```
Summary:  [Kase][Critical] IDOR allows invoice access across users
Labels:   kase, security, authz, cwe-639

h2. Reproduction
{code}
curl -H "Authorization: Bearer <user-a-token>" \
     https://staging.acme.com/api/invoices/123
-> 200, returns invoice owned by user B
{code}

h2. Source
src/invoices/invoice.service.ts — InvoiceService.find
Correlation: runtime_dump (verified, commit a3f9c1e)

h2. Impact
Any authenticated user can read any invoice, exposing customer billing data.

h2. Remediation
{code:diff}
- return this.prisma.invoice.findUnique({ where: { id } })
+ return this.prisma.invoice.findFirst({ where: { id, ownerId: user.id } })
{code}

h2. Evidence
EV-124 http_exchange (replayable) · EV-126 sast_json
Audit: https://kase.../audits/aud_01H...
```

### Duplicate prevention

Keyed on **fingerprint**, stored in `JiraIssue.fingerprint`.

```
finding arrives
  -> existing JiraIssue for this fingerprint?
       yes, open      -> add comment "seen again in audit N", do not create
       yes, closed    -> reopen, comment "regressed in audit N"
       no             -> create
```

Without fingerprint keying, every audit creates a fresh ticket for the same bug — the single fastest way to make a team mute the integration.

### Status sync

One-way by default: Kase → Jira. Optional inbound webhook maps Jira transitions to finding lifecycle:

| Jira transition | Finding effect |
|---|---|
| Done / Resolved | Suggests `fixed`; **requires a regression audit to confirm** |
| Won't Do | Prompts `accepted_risk` or `false_positive` in Kase |
| Reopened | `regressed` |

Jira closing a ticket never marks a Kase finding `fixed` on its own. Only a regression check does. Otherwise the gate can be opened by editing a ticket.

## 4. Common integration rules

| Rule | Reason |
|---|---|
| All external calls are retried with backoff and are idempotent | Integrations fail; audits should not |
| Integration failure never fails the audit | It marks `integration_failed` and is reported |
| All outbound payloads pass the redactor | Evidence excerpts can carry secrets |
| Every integration action is written to the audit trail | Who created what, when, from which audit |
| Rate limits are respected per provider | GitHub secondary limits in particular |

---

**Next:** [14 — REST API](../14-api/README.md)
