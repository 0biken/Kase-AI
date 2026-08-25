# 12 — Policy Engine & Release Gate

The deterministic decision layer. Where Kase earns the right to sit in a CI pipeline.

---

## 1. Principle

> AI-reviewed findings never directly control the gate.

The gate is a pure function of validated findings, evidence classes, and a versioned policy. It contains no model call, no probability arithmetic, and no judgement. Given the same findings and the same policy, it always returns the same outcome — and it can explain exactly why.

```
Finding
   |
Schema validation          -- is it well-formed?
   |
Evidence class check       -- is it replayable?
   |
Correlation verification   -- is the source location trustworthy?
   |
Suppression / waiver check -- has a human decided otherwise?
   |
Policy evaluation          -- deterministic rules
   |
Release decision           -- PASS / FAIL / PARTIAL
```

## 2. Why not a confidence threshold

A rule like `BLOCK if severity = critical AND confidence >= 0.90` looks rigorous and is not. An LLM-emitted `0.91` is not a calibrated probability: it is a token. It drifts between model versions, shifts with prompt changes, and is not comparable across categories. Building a deterministic gate on top of it means gate behaviour changes when the provider updates a model, on unchanged code.

Kase gates on **evidence class** instead — an objective, verifiable property of the artifact rather than a self-report from the thing being judged.

## 3. Evidence-class gating

### The rule

```
A finding may BLOCK only if it carries at least one artifact of a
REPLAYABLE evidence class:

  - a scanner rule hit with file + enclosing symbol
      (semgrep, gitleaks, nuclei, dependency scan)
  - a stored HTTP exchange that reproduces on replay
  - a failing regression test case

Findings whose only evidence is non-replayable
  (screenshots, traces, console logs, prose reproductions,
   AI-inferred correlations)
  -> WARN / REQUIRES_REVIEW. Never BLOCK.
```

### Why not "at least two evidence artifacts"

Counting artifacts is weak. Two screenshots of the same page is two artifacts and proves nothing more than one. The requirement is **one artifact of a replayable class**, not a count of any class.

### Replay verification

For `http_replay` reproductions, the gate job re-issues the stored request against the current build before blocking. Three outcomes:

| Replay result | Effect |
|---|---|
| Reproduces | BLOCK confirmed |
| Does not reproduce | Finding transitions to `fixed`; not blocking |
| Replay errored (target down, timeout) | **BLOCK stands** — fail closed |

This is what makes a Kase gate defensible in a code review: the block is accompanied by a request the engineer can run themselves.

## 4. Gate policy

Versioned, project-scoped, stored, and referenced by ID and version on every evaluation so a historical decision remains reproducible.

```yaml
version: 3
name: default

block_on:
  # Deterministic scanner results — always eligible
  - source: deterministic
    severity: [critical]
  - source: deterministic
    category: [static_security, secrets, dependencies]
    severity: [critical, high]

  # Agent findings — only with replayable evidence
  - source: agent
    severity: [critical]
    requires_replayable_evidence: true
  - source: agent
    category: [authz, authn]
    severity: [critical, high]
    requires_replayable_evidence: true

  # Regression
  - regression: critical_test_failed
  - finding_status: [regressed]
    severity: [critical, high]

  # Coverage
  - required_categories_not_executed: true

warn_on:
  - source: agent
    severity: [high]
    requires_replayable_evidence: false
  - correlation_method: [ai_inference]
  - provenance_unverified: true

required_categories:
  - security
  - authz
  - static_security
  - dependencies

fail_closed:
  audit_status: [failed, partial]
  provenance_verified: false_blocks_correlated_findings_only
  replay_error: block

waivers:
  max_duration_days: 30
  require_separate_approver: true
  warn_before_expiry_days: 7
```

## 5. Waivers

A gate with no override is a gate that gets disabled. A gate with a permanent override is not a gate. Waivers are the middle path: explicit, attributed, and **time-boxed**.

```
BLOCK
  |
Override requested
  |
Reason required
  |
Approval (separate approver if policy requires)
  |
Temporary waiver, mandatory expiry
  |
Release allowed
```

### Rules

| Rule | Rationale |
|---|---|
| `expiresAt` is **mandatory** | No permanent "ignore forever". Permanent acceptance is `accepted_risk`, a different decision with a different record |
| Scoped to **fingerprint**, not `Finding.id` | A finding ID is per-audit; the waiver would evaporate on the next run |
| Reason is required, free text, stored | The waiver record is the artifact a future reviewer reads |
| `require_separate_approver` configurable | Self-approved waivers are how gates become decorative |
| **Warn before expiry** | Default 7 days. A waiver that silently expires produces a surprise red build at the worst moment |
| Waiver usage is reported | Every gate evaluation lists `waivedFindingIds`; the report has a waiver section |

### Expiry warnings surface in three places

The report, the CI output, and the dashboard — because the person who sees a red build is rarely the person who granted the waiver.

## 6. Outcomes

| Outcome | Conditions | CI exit |
|---|---|---|
| **PASS** | Audit `completed`, not degraded, no blocking findings, all required categories executed | 0 |
| **FAIL** | Any blocking finding, or a required category not executed, or audit `failed` | 1 |
| **PARTIAL** | Audit `partial` or `degraded` — budget exhaustion, tool failure, skipped categories | 2 |

`PARTIAL` is a first-class outcome, not a soft pass. It means *Kase did not complete enough of the audit to make a claim.* Projects choose whether `PARTIAL` blocks their pipeline; the default is that it does.

Collapsing `PARTIAL` into `PASS` is the failure mode this design exists to prevent: it would let a budget overrun or a crashed scanner produce a green build.

## 7. Fail closed

Infrastructure failure is never a PASS.

| Condition | Outcome |
|---|---|
| Orchestrator crash, audit incomplete | FAIL until re-run completes |
| Required category `not_executed` | FAIL |
| Target unreachable | FAIL |
| Replay verification errored | BLOCK stands |
| Evidence integrity check failed | Finding non-eligible; if it was the only blocker, outcome PARTIAL |
| Gate policy fails to load | FAIL |

## 8. Gate evaluation output

Every evaluation is persisted and is fully explainable.

```json
{
  "auditId": "aud_01H...",
  "outcome": "fail",
  "gatePolicyId": "gp_01H...",
  "gatePolicyVersion": 3,
  "commitSha": "a3f9c1e",
  "evaluatedAt": "2026-08-24T11:04:22Z",
  "blocking": [
    {
      "findingId": "fnd_01H...",
      "fingerprint": "8c1f...",
      "title": "IDOR allows invoice access across users",
      "severity": "critical",
      "rule": "block_on[0] source=agent severity=critical",
      "evidence": [
        { "id": "EV-124", "type": "http_exchange", "replayable": true,
          "replayResult": "reproduced" }
      ],
      "sourceLocation": {
        "file": "src/invoices/invoice.service.ts",
        "enclosingSymbol": "InvoiceService.find",
        "correlationMethod": "runtime_dump",
        "verified": true
      }
    }
  ],
  "warnings": [
    { "findingId": "fnd_01J...", "reason": "correlation_method=ai_inference" }
  ],
  "waived": [
    { "fingerprint": "2b7e...", "expiresAt": "2026-09-02T00:00:00Z",
      "approvedBy": "alex@example.com", "daysRemaining": 9 }
  ],
  "notExecutedCategories": [],
  "degraded": false
}
```

Every block cites the policy rule that produced it and the evidence that supports it. An engineer can disagree with the finding, but never with *why the gate fired*.

## 9. Stability across runs

Agent output is not perfectly deterministic. The gate is stabilized structurally rather than by hoping for reproducibility:

| Mechanism | Effect |
|---|---|
| Gate keys on **fingerprints**, not fresh verdicts | Identity persists across runs |
| `not_reproduced` stays blocking | A finding vanishing does not open the gate |
| Deterministic scanner results dominate blocking rules | Same input, same output |
| Replay verification | The block is re-checked against reality, not re-judged |
| Suppressions are durable | Confirmed false positives do not return |

Without these, gate outcomes flap and the gate gets disabled. With them, the gate is stable even though the agent is not.

## 10. Rollout guidance

Do not switch a new project straight to blocking.

| Phase | Duration | Mode |
|---|---|---|
| 1. Observe | 2 weeks | Gate evaluates and reports; never blocks |
| 2. Block criticals | 2 weeks | Deterministic critical findings only |
| 3. Full policy | — | Default policy active |

Phase 1 is where the project's false-positive profile becomes visible and suppressions get established. Skipping it is the most common way a gate loses credibility before it has earned any.

---

**Next:** [13 — Integrations](../13-integrations/README.md)
