# 15 — CLI

`kase` — the primary interface for CI and for local use.

---

## 1. Design rules

| Rule | Reason |
|---|---|
| Every command works non-interactively | It runs in CI first, on a laptop second |
| Human output by default, `--json` for machines | Piping should be first-class |
| Exit codes are the contract | CI reads exit codes, not stdout |
| Never poll tools directly; consume the SSE stream | Progress without hammering the API |
| Secrets only from env or stdin, never argv | Argv is visible in process lists and CI logs |

## 2. Commands

### Authenticate

```bash
kase auth login --token $KASE_TOKEN
kase auth status
```

Token is read from `KASE_TOKEN` when the flag is omitted. Stored in the OS keychain locally; in CI it stays in memory.

### Start an audit

```bash
kase audit start \
  --project acme-web \
  --target staging \
  --mode full \
  --commit "$GITHUB_SHA" \
  --route-map .kase/routes.json \
  --wait
```

| Flag | Notes |
|---|---|
| `--commit` | **Strongly recommended.** Produces verified `BuildProvenance`; without it correlated findings are not gate-eligible |
| `--route-map` | Runtime route dump; upgrades correlation from inference to ground truth |
| `--mode` | `full` (default), `smoke`, `security`, `regression` |
| `--categories` | Comma-separated subset |
| `--wait` | Stream progress and exit on the audit's terminal state |
| `--budget-minutes` | Override wall-clock budget |
| `--json` | Machine-readable output |

The CLI **warns prominently** when `--commit` is omitted:

```
warning: no --commit supplied. Build provenance will be 'assumed' and
         unverified. Correlated findings will not be gate-eligible.
         Pass --commit $GITHUB_SHA to enable source-grounded gating.
```

### Run a specific mode

```bash
kase audit start --project acme-web --target staging --mode security --wait
kase audit start --project acme-web --target staging --mode smoke --wait
```

### Regression

```bash
kase audit regression \
  --project acme-web \
  --target staging \
  --commit "$GITHUB_SHA" \
  --since-audit aud_01H... \
  --wait
```

Replays stored reproductions for open findings and transitions their state. This is the **only** mechanism that moves a finding to `fixed` — absence in a normal audit yields `not_reproduced`, which still blocks.

### Evaluate the gate

```bash
kase gate evaluate --audit aud_01H... --fail-on fail,partial
```

```
Kase gate — FAIL

  Policy       default v3
  Audit        aud_01H2X4  (full, completed, not degraded)
  Commit       a3f9c1e     (provenance: ci_supplied, verified)
  Coverage     12/12 required categories executed

  Blocking (2)
    CRITICAL  IDOR allows invoice access across users
              src/invoices/invoice.service.ts · InvoiceService.find
              rule: block_on[0] source=agent severity=critical
              evidence: EV-124 http_exchange (replayed: reproduced)

    HIGH      Hardcoded API key in source
              src/config/stripe.ts · stripeConfig
              rule: block_on[1] category=secrets severity=high
              evidence: EV-201 sast_json (gitleaks.stripe-access-token)

  Warnings (5)
    3 findings with AI-inferred correlation (advisory, not blocking)
    2 high-severity findings without replayable evidence

  Waivers (1)
    2b7e...  expires in 9 days  approved by alex@acme.com
             "Fix scheduled for release 4.2"

  Report  https://kase.acme.com/audits/aud_01H2X4

exit 1
```

Every block cites its policy rule and its evidence. An engineer can disagree with the finding; they should never have to guess why the gate fired.

### Findings

```bash
kase findings list --audit aud_01H... --severity critical,high
kase findings show fnd_01H...
kase findings show fnd_01H... --patch          # print the fix diff
kase findings jira fnd_01H...
```

### Waivers

```bash
kase waiver create \
  --fingerprint 2b7e... \
  --reason "Fix scheduled for 4.2; endpoint VPN-restricted meanwhile" \
  --expires 2026-09-15

kase waiver list --expiring 7
```

`--expires` is mandatory. There is no permanent-waiver flag.

### Local report

```bash
kase report get --audit aud_01H... --format markdown --out ./kase-report/
```

Writes the full document set — executive summary plus per-category files plus an evidence index — mirroring the skills' report structure.

## 3. Exit codes

The contract CI depends on.

| Code | Meaning |
|---|---|
| `0` | Gate PASS |
| `1` | Gate FAIL — blocking findings, or required category not executed |
| `2` | Gate PARTIAL — audit degraded or incomplete |
| `3` | Scope violation — target not in allowlist, or attestation missing/stale |
| `4` | Authentication or authorization failure |
| `5` | Kase infrastructure error — audit could not run |
| `130` | Cancelled (SIGINT) |

`--fail-on` selects which outcomes map to a non-zero exit. Default `fail,partial`.

## 4. Config file

`.kase.yml`, repository root. CLI flags override it.

```yaml
project: acme-web
target: staging
mode: full
route_map: .kase/routes.json
fail_on: [fail, partial]
categories:
  - security
  - authz
  - static_security
  - dependencies
```

## 5. CI example

```bash
#!/usr/bin/env bash
set -euo pipefail

npx kase-routemap --framework nestjs --out .kase/routes.json

kase audit start \
  --project acme-web \
  --target staging \
  --commit "$GITHUB_SHA" \
  --route-map .kase/routes.json \
  --wait --json > audit.json

AUDIT_ID=$(jq -r .id audit.json)
kase gate evaluate --audit "$AUDIT_ID" --fail-on fail,partial
```

## 6. Local development use

```bash
kase audit start --project acme-web --target local --mode smoke --wait
kase findings list --severity critical,high
kase findings show fnd_01H... --patch | git apply -
```

The last line is the point of insisting every finding carry a real patch rather than advice.

---

**Next:** [16 — Web Dashboard](../16-web/README.md)
