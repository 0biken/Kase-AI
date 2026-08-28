# 07 — Tool Adapters

The common interface every tool implements, and the per-tool specifications.

---

## 1. Adapter interface

```ts
interface ToolAdapter {
  metadata(): AdapterMetadata          // name, version, capabilities, image digest
  validate(input: unknown): Result     // schema + scope + policy
  prepare(ctx: JobContext): Promise<void>   // fetch inputs, warm caches
  execute(ctx: JobContext): Promise<RawResult>
  collectEvidence(raw: RawResult): Promise<Evidence[]>
  normalizeResult(raw: RawResult): NormalizedFinding[]
  cleanup(): Promise<void>
}

interface AdapterMetadata {
  name: string
  toolVersion: string        // pinned
  imageDigest: string        // recorded on every ToolExecution
  capabilities: string[]     // typed capability names it serves
  requiresTargetEgress: boolean
  requiresInternetEgress: string[]   // explicit host allowlist
  defaultTimeoutMs: number
  produces: EvidenceType[]
}
```

Every adapter must:

- declare its capabilities (typed, never command-shaped),
- validate prerequisites before spending anything,
- execute inside a controlled worker,
- capture raw output as evidence **before** normalizing,
- normalize into the common finding shape,
- **fail independently of the audit**.

## 2. Two rules that are not negotiable

### 2.1 Raw evidence is captured before normalization

Normalization is lossy and Kase-versioned. The raw tool output is the ground truth and is stored first, hashed, immutable. If normalization logic changes later, historical findings remain re-derivable.

### 2.2 Adapters never assign severity

`normalizeResult()` emits `severityProposed` at most. The centralized severity engine ([09 §3](../09-findings/README.md#3-severity-engine)) assigns the authoritative value. Otherwise each tool's idiosyncratic scale leaks into the gate and the gate becomes incomparable across categories.

## 3. Failure isolation

| Outcome | `AuditJob.status` | Category effect | Gate effect |
|---|---|---|---|
| Success | `succeeded` | executed | Normal |
| Non-zero exit, parseable output | `succeeded` | executed | Normal |
| Non-zero exit, no output | `failed` after retries | `not_executed` | FAIL if category required |
| Timeout | `timed_out` | `not_executed` | FAIL if category required |
| Tool binary missing | `failed` (no retry) | `not_executed` | FAIL if category required |
| Scope denial | `skipped` | `not_executed(out_of_scope)` | Policy-dependent |

A failing tool never fails the audit. It fails its **category**, and the gate decides what that means.

## 4. Adapter catalogue

### 4.1 `http` — HTTP/API probing

| | |
|---|---|
| Capability | `run_http_probe` |
| Binary | native Node fetch / undici |
| Evidence | `http_exchange` (**replayable**) |
| Egress | Target only |

Captures full request and response including headers, timing, and body (truncated at 1 MB, hashed in full). The stored exchange is replayable — this is the primary gate-eligible evidence class for black-box findings.

```ts
HttpExchange {
  request:  { method, url, headers, body, timestamp }
  response: { status, headers, body, timingMs }
  replayHash: string   // stable identity for re-execution
}
```

### 4.2 `katana` — crawling

| | |
|---|---|
| Capability | `run_crawl` |
| Binary | Go, pinned version |
| Evidence | `crawl_result` |
| Egress | Target only |
| Notes | Output feeds the scope validator before anything is probed — see [06 §5](../06-recon/README.md#5-every-discovered-url-re-enters-the-scope-validator) |

### 4.3 `httpx` — probe verification

| | |
|---|---|
| Capability | `run_http_probe` (bulk mode) |
| Binary | Go, pinned |
| Evidence | `http_exchange`, tech fingerprint metadata |
| Egress | Target only |

### 4.4 `playwright` — browser automation

| | |
|---|---|
| Capability | `run_browser_check` |
| Evidence | `screenshot`, `trace`, `console_log`, `network_log` |
| Egress | Target only |
| Browsers | Chromium required; Firefox and WebKit best-effort, absence is not a category failure |

Captures per run: screenshots across the requested viewport × theme matrix, a Playwright trace, console output, and the full network log. Traces are large — subject to the evidence size cap in [08 §6](../08-evidence/README.md#6-size-limits-and-truncation).

Authenticated sessions use credentials resolved at worker start from the secret store, and every credential value is registered with the redactor before the browser launches.

### 4.5 `axe` — accessibility

| | |
|---|---|
| Capability | `run_a11y_scan` |
| Library | axe-core, injected via Playwright |
| Evidence | `axe_json` (**replayable** — rule + selector is stable) |
| Normalizes to | `category: accessibility`, `ruleId: axe.<rule>`, WCAG criterion in metadata |

### 4.6 `lighthouse` — performance

| | |
|---|---|
| Capability | `run_perf_scan` |
| Evidence | `lighthouse_json` |
| Notes | Scores are environment-sensitive. Performance findings are **advisory by default** — a Lighthouse score is not stable enough to block a release unless the project explicitly opts in with a fixed budget. |

### 4.7 `nuclei` — template scanning

| | |
|---|---|
| Capability | `run_template_scan` |
| Binary | Go, pinned; template bundle version pinned and recorded |
| Evidence | `http_exchange` per match (**replayable**) |
| Egress | Target only |

Deterministic and versioned, which makes its output gate-eligible. Template tags are restricted by scope policy; intrusive template classes require `destructiveAllowed`.

### 4.8 `semgrep` — SAST

| | |
|---|---|
| Capability | `run_sast` |
| Runtime | Python, pinned; ruleset version recorded |
| Evidence | `sast_json` (**replayable** — rule + file + symbol) |
| Egress | **None** (offline rule bundle) |
| Open item | Ruleset licensing — see [02 §3](../02-stack/README.md#3-open-item-semgrep-licensing) |

Normalizes to `ruleId: semgrep.<rule-id>`, `cwe` from rule metadata, and a `SourceLocation` carrying the enclosing symbol resolved from the AST — not just the line.

### 4.9 `gitleaks` — secret scanning

| | |
|---|---|
| Capability | `run_secret_scan` |
| Evidence | `sast_json` with **secret values redacted at capture** |
| Egress | None |

The adapter never writes the matched secret to evidence. It stores rule, file, symbol, line, and a partial-match fingerprint. Scans commit history as well as the working tree when the checkout is not shallow.

### 4.10 `deps` — dependency vulnerabilities

| | |
|---|---|
| Capability | `run_dependency_scan` |
| Backends | `npm audit`, `pip-audit`, `osv-scanner` |
| Evidence | `dependency_json` (**replayable**) |
| Egress | Advisory database hosts only, explicitly allowlisted |

Normalizes to `ruleId: cve.<id>` or `ghsa.<id>`, with the dependency path recorded so transitive vulnerabilities are distinguishable from direct ones.

### 4.11 `codemap` — route and symbol extraction

| | |
|---|---|
| Capability | internal (not agent-callable) |
| Evidence | `git_metadata`, code map JSON |
| Egress | None |

Produces `RouteMapping[]` for the correlation engine. Detailed in [10 §3](../10-correlation/README.md#3-layer-1--deterministic-mapping).

### 4.12 `k6` — load testing

| | |
|---|---|
| Capability | `run_load_test` |
| Evidence | `test_output` (k6 JSON summary), `metrics_timeseries` |
| Egress | Target allowlist only |

Promoted from v1.1 by [ADR-014](../20-adr/README.md#adr-014--k6-in-v1-behind-explicit-authorization). It was originally cut as the highest-incident-risk adapter, and that assessment still stands — it is admitted only because the containment below now exists.

**k6 findings never block.** A load profile is not reproducible run-to-run, so k6 evidence is non-replayable, and [12 §3](../12-policy-gate/README.md#3-evidence-class-gating) is absolute about what that means: non-replayable evidence warns, it never blocks.

An explicit SLO budget in the gate policy therefore changes *whether a finding is raised at all*, not whether it can block. Without a budget there is no threshold to breach and k6 reports metrics only; with one, a breach is a reported finding measured against a number the project committed to rather than one the tool invented. Either way the gate outcome is WARN.

Safety rules, all orchestrator-enforced rather than adapter-enforced:

| Rule | Enforcement |
|---|---|
| Disabled against `environment: 'production'` | Requires `destructiveAllowed` **and** a separate named attestation naming the target ([17 §3](../17-security/README.md#3-scope-validation)) |
| Virtual users and duration capped | Ceilings from the gate policy; the adapter cannot raise its own limits |
| Shares the audit's global RPS budget | A load test cannot exceed `maxRequestsPerSecond` — the same ceiling every other adapter obeys, counted globally so two concurrent audits do not sum to 2× the agreed rate |
| Aborts on target error-rate spike | A target failing under load is a result, not a licence to keep pushing |

The distinction from every other adapter: k6 deliberately *degrades the target*. That is why the caps live in the orchestrator, where the scope validator already sits, and not in the adapter that would benefit from raising them.

## 5. Evidence class summary

Which adapters produce evidence that can block a release:

| Adapter | Replayable | Gate-eligible |
|---|---|---|
| `http`, `httpx` | Yes | Yes |
| `nuclei` | Yes | Yes |
| `semgrep` | Yes | Yes |
| `gitleaks` | Yes | Yes |
| `deps` | Yes | Yes |
| `axe` | Yes | Yes (if policy includes a11y) |
| `playwright` | No (screenshots/traces) | No — supporting evidence only |
| `lighthouse` | No | Advisory unless explicit budget set |
| `k6` | No (load profile is not reproducible run-to-run) | No — advisory only, even with an SLO budget |
| `katana` | No | No — discovery only |

See [12 §3](../12-policy-gate/README.md#3-evidence-class-gating).

## 6. Adding an adapter

1. Implement `ToolAdapter`.
2. Register the typed capability in the agent tool contract ([05 §4](../05-agent-runtime/README.md#4-the-tool-contract)).
3. Declare egress requirements; add hosts to the worker's allowlist.
4. Pin tool version and record `imageDigest`.
5. Define `ruleId` namespace — it enters fingerprints and must be stable.
6. Declare `replayable` per evidence type. **Getting this wrong changes gate behaviour**, so it is reviewed explicitly.
7. Add golden-output normalization tests.

---

**Next:** [08 — Evidence Store](../08-evidence/README.md)
