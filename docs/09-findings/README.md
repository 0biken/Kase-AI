# 09 — Finding Engine

Normalization, severity, fingerprinting, deduplication, lifecycle.

---

## 1. Pipeline position

```
tool output / agent proposal
        |
   NORMALIZER          common schema, severity stripped
        |
  INGEST DEDUP         exact match only, cheap
        |
   CORRELATION         attaches source locations   -> [10]
        |
  SEVERITY ENGINE      authoritative severity
        |
  FINGERPRINT          deterministic inputs only
        |
 SEMANTIC DEDUP        cross-tool + cross-audit identity
        |
   AI REVIEW           advisory enrichment          -> [11]
        |
  GATE ELIGIBILITY     derived, evidence-class based -> [12]
```

Correlation sits **before** semantic dedup deliberately: correlation is what supplies the source location, and source location is the strongest dedup key. See [01 §2.3](../01-architecture/README.md#23-correlation-comes-before-semantic-dedup).

## 2. Normalization

Every source — deterministic tool or agent proposal — is normalized into one shape before anything else touches it.

```ts
NormalizedFinding {
  origin: 'blackbox' | 'whitebox' | 'tool'
  tool: string
  ruleId: string | null          // null for agent-authored findings
  category: string               // controlled vocabulary
  cwe: string | null
  title: string
  description: string
  affectedTarget: string | null  // normalized path template
  sourceLocations: SourceLocation[]
  reproduction: Reproduction
  impact: string
  fix: string
  fixPatch: string | null
  evidenceIds: string[]
  severityProposed: string | null   // advisory only, discarded after §3
}
```

### Category vocabulary

Fixed, because it enters fingerprints and gate policy. Derived from the two skills' reference files.

```
Black box:  recon, security, authn, authz, api_surface, content_safety,
            performance, accessibility, seo, ux, observability,
            functional, network_resilience, load

White box:  code_map, static_security, secrets, dependencies, authz_logic,
            input_validation, error_handling, code_quality, test_coverage,
            iac, license
```

### Reproduction must be structured

Prose reproductions cannot be replayed, and unreplayable findings cannot block a release.

```ts
type Reproduction =
  | { kind: 'http_replay';   evidenceId: string }
  | { kind: 'browser_steps'; steps: BrowserStep[]; evidenceId: string }
  | { kind: 'source_rule';   ruleId: string; file: string; enclosingSymbol: string }
  | { kind: 'test_case';     testId: string; command: string }
  | { kind: 'manual';        steps: string[] }        // never gate-eligible
```

## 3. Severity engine

Severity is assigned centrally. Tools and agents propose; the engine decides. Without this, each tool's private scale leaks into the gate and severities are incomparable across categories.

| Severity | Meaning |
|---|---|
| `critical` | Release-blocking: severe security, data-integrity, availability, or core-function failure |
| `high` | Major exploitable or business-impacting issue |
| `medium` | Significant but non-critical defect or risk |
| `low` | Minor issue, limited impact |
| `info` | Observation or improvement |

### Inputs

```ts
severity = engine.assess({
  category,
  cwe,
  ruleSeverity,          // tool's own rating, as a signal
  exploitability,        // reachable? authenticated? preconditions?
  affectedScope,         // single user / all users / whole system
  dataSensitivity,       // from project config
  environment,           // production weighted above staging
  severityProposed       // agent's proposal, as a signal
})
```

### Deterministic floors

Certain conditions cannot be rated below a floor regardless of other signals:

| Condition | Floor |
|---|---|
| Verified secret in source, live credential | `critical` |
| Authenticated IDOR with cross-tenant read | `critical` |
| RCE-class SAST rule on reachable path | `critical` |
| Auth bypass | `critical` |
| Known-exploited CVE (KEV catalogue) in direct dependency | `high` |
| Missing authz check on a mutating endpoint | `high` |

Floors are policy, versioned with the project, and recorded on the finding so a severity is always explainable.

## 4. Fingerprinting

The fingerprint is the identity of a *problem*, stable across runs and across code edits. Everything about regression tracking, waivers, and suppression depends on it being stable.

### Composition

```ts
fingerprint = sha256([
  category,
  ruleId ?? synthesizedRuleKey,    // see below
  normalizedTarget,                // '/api/invoices/{id}' — params stripped
  sourceFile ?? '',
  enclosingSymbol ?? '',           // NOT the line number
  cwe ?? ''
].join('|'))
```

### Two exclusions that matter

**Root cause is excluded.** Root cause is AI-authored prose. Including it makes the fingerprint change whenever the model rephrases, which breaks `firstSeen`/`lastSeen`, resurfaces fixed findings as new, and silently voids waivers. Root cause informs Level 3 similarity matching only — it never enters the hash.

**Line numbers are excluded.** Any edit above line 84 shifts it, and the finding appears new. The **enclosing symbol** (`InvoiceController.findOne`) is stable across unrelated edits and is what Semgrep and CodeQL effectively key on. Line numbers are retained on `SourceLocation` for display and navigation only.

### Agent-authored findings

Agent findings have no `ruleId`. A synthesized key is derived from stable structural attributes only:

```ts
synthesizedRuleKey = `agent.${category}.${cwe ?? 'nocwe'}.${normalizedTarget}`
```

Deliberately coarse. Coarse-but-stable is correct here: over-merging two related findings is recoverable by a human, while unstable identity silently destroys history.

## 5. Deduplication

### Pass 1 — Ingest dedup (before correlation)

Exact match on `(tool, ruleId, rawTarget, sourceFile, line)`. Drops literal repeats from a single tool run. Cheap, no ambiguity.

### Pass 2 — Semantic dedup (after correlation)

Three levels, producing a three-way outcome rather than a forced binary.

**Level 1 — exact fingerprint match**
Same fingerprint. Result: `MATCH`. Merge into the existing `FindingIdentity`, union evidence.

**Level 2 — structural match without source location**
When correlation could not attach a source location:

```
same category
+ same normalizedTarget
+ same cwe
+ compatible severity band
```
Result: `MATCH` if all agree, `POSSIBLE_MATCH` if `cwe` is absent on one side.

**Level 3 — AI-assisted similarity**
Only for the ambiguous remainder. The model compares titles, descriptions, root causes, and evidence, and returns a band. Result: `POSSIBLE_MATCH` at most — **AI similarity alone never produces an automatic `MATCH`**.

### The three-way outcome

| Outcome | Action |
|---|---|
| `MATCH` | Merge into existing identity |
| `POSSIBLE_MATCH` | Create new identity, link via `FindingRelation`, **queue for human review** |
| `NEW_FINDING` | Create new identity |

`POSSIBLE_MATCH` never auto-resolves in either direction. Forcing a binary decision here is how platforms either lose findings or drown users in duplicates.

### Cross-source merging

The point of merging is that one problem seen twice is one finding:

```
semgrep:  missing ownership predicate      src/invoices/invoice.service.ts
              +
black box: GET /api/invoices/123 returns another user's invoice
              +
correlation: /api/invoices/{id} -> InvoiceController.findOne -> InvoiceService.find
              =
ONE finding, severity critical, both evidence artifacts preserved,
external reproduction AND exact source location
```

Merged findings retain every contributing artifact. Merging is presentation and identity, never evidence loss.

## 6. Lifecycle

`FindingIdentity.status` is project-scoped and persists across audits.

```
                    NEW
                     |
                     v
                   OPEN <---------------------+
                  /  |  \                     |
                 /   |   \                    |
                v    v    v                   |
   NOT_REPRODUCED  FIXED  FALSE_POSITIVE      |
                     |         |              |
                     v         v              |
                 VERIFIED   SUPPRESSED        |
                     |                        |
                     v                        |
                 REGRESSED --------------------+

   ACCEPTED_RISK  <- from OPEN, by explicit decision
```

| State | Meaning | Gate |
|---|---|---|
| `new` | First occurrence this audit | Blocking if eligible |
| `open` | Seen again, not resolved | Blocking if eligible |
| `not_reproduced` | Absent this audit, no fix confirmed | **Still blocking** |
| `fixed` | Absent **and** a regression check confirmed the fix | Not blocking |
| `verified` | Fix confirmed across a subsequent audit | Not blocking |
| `regressed` | Reappeared after `fixed`/`verified` | Blocking, severity floor raised one band |
| `false_positive` | Human-confirmed non-issue | Not blocking; creates a `Suppression` |
| `accepted_risk` | Deliberate permanent acceptance | Not blocking; requires approver + rationale |

### Three states people forget, and why each is required

**`not_reproduced` ≠ `fixed`.** Absence of evidence is not a fix. A flaky crawl, a rate limit, or a slightly different agent path can all make a real finding vanish for one run. Auto-marking it `fixed` means gates go green on unfixed criticals. It stays blocking until a regression check explicitly confirms the fix.

**`false_positive` must feed a suppression store.** Marking something a false positive has to be *durable*, keyed on fingerprint. Without it, humans re-triage identical noise every single run — which is precisely how a QA gate becomes a muted notification.

**`accepted_risk` ≠ waiver.** A waiver is time-boxed and expires ([12 §5](../12-policy-gate/README.md#5-waivers)). `accepted_risk` is a permanent, deliberate product decision with a named owner. Collapsing the two means either permanent risks generate recurring noise, or temporary waivers quietly become permanent.

## 7. Confidence is a band, not a number

```ts
confidenceBand: 'high' | 'medium' | 'low'
```

An LLM-emitted `0.91` is not a calibrated probability and drifts between model versions. Representing it as a float invites downstream arithmetic — thresholds, averaging, weighted scoring — on a number that does not support it.

| Band | Assigned when |
|---|---|
| `high` | Deterministic tool rule hit, or agent finding with replayable evidence and verified correlation |
| `medium` | Agent finding with replayable evidence, correlation unverified or absent |
| `low` | Agent finding with only non-replayable evidence, or AI-inferred correlation |

Gate eligibility keys on **evidence class**, not on this band. The band drives review-queue ordering and report presentation.

## 8. Gate eligibility

```ts
gateEligible =
     severity in policy.blockingSeverities
  && evidence.some(e => e.replayable)
  && (origin !== 'correlated' || correlation.verified)
  && !['false_positive', 'accepted_risk'].includes(identity.status)
  && !activeWaiverFor(fingerprint)
```

Computed by the finding engine, enforced by the policy engine. See [12](../12-policy-gate/README.md).

---

**Next:** [10 — Correlation Engine](../10-correlation/README.md)
