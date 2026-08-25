# 04 — Audit Orchestrator

The deterministic spine. Owns audit state, the job graph, budgets, and resumability.

---

## 1. Responsibility

The orchestrator is deliberately **not** intelligent. It does not decide what a finding means. It decides what runs, in what order, under what limits, and what the audit's terminal state is.

| Owns | Does not own |
|---|---|
| Audit state machine | Finding semantics |
| Job graph construction and scheduling | Severity assignment |
| Budget enforcement (tokens, time, requests) | Correlation logic |
| Scope policy attachment to every job | Gate decision |
| Partial/degraded determination | Report prose |

## 2. Audit state machine

```
              queued
                |
          [scope validated]
                |
             running
                |
      +---------+---------+----------+
      |         |         |          |
  completed  partial   failed   cancelled
```

| State | Meaning | Gate consequence |
|---|---|---|
| `completed` | All required categories executed, no degradation | Eligible for PASS |
| `partial` | Executed, but degraded (budget, tool failure, skipped category) | **Never PASS** |
| `failed` | Could not produce a usable result | FAIL |
| `cancelled` | User-cancelled | No gate evaluation |

`partial` exists specifically so a budget overrun cannot silently become a green build. See §6.

## 3. Audit lifecycle

### Stage 0 — Scope validation (blocking)

Before any job is enqueued:

1. Resolve `ScopePolicy` for the project.
2. Verify `Target.baseUrl` host matches `allowedHosts`.
3. Verify authorization attestation exists and is not stale.
4. If `mode` requires destructive checks and `destructiveAllowed === false`, drop those categories and record them in `notExecutedCategories`.

Failure here aborts before spending anything.

### Stage 1 — Build provenance (blocking)

Resolve the commit SHA of the running target, in priority order:

1. `ci_supplied` — CI passed `--commit <sha>`. Highest trust.
2. `build_info_endpoint` — `Target.buildInfoUrl` returns a SHA.
3. `response_header` — e.g. `X-Build-SHA`.
4. `assumed` — fall back to repo default branch HEAD. Sets `verified: false`.

Checkout the repository at that SHA. If `verified === false`, the audit continues but **every correlation it produces is non-gate-eligible**. This is surfaced in the report, the dashboard, and the CI output as a warning, not buried.

### Stage 2 — Planning

The planner produces the job graph from `mode`, `requestedCategories`, `ScopePolicy`, and prior-audit history. It is a **single AI call** at most, and its output is schema-validated; if validation fails, fall back to the static plan for that mode.

The plan is persisted before execution so an audit is reproducible and reviewable.

### Stage 3 — Job graph execution

```
scope_validate
      |
build_provenance
      |
    recon ──────────────┐
      |                 |
endpoint_inventory      |
      |                 |
      +---------+-------+--------+
      |         |                |
 blackbox_agent |          whitebox_agent
      |         |                |
      |    tool jobs             |
      |    (axe, lighthouse,     |  (semgrep, gitleaks,
      |     nuclei, http)        |   deps, code_map)
      |         |                |
      +---------+----------------+
                |
          normalize
                |
          ingest_dedup
                |
           correlate
                |
       fingerprint_dedup
                |
            ai_review
                |
              report
                |
          integrations
                |
          gate_evaluate
```

Rules:

- A job runs when all `dependsOn` jobs are terminal (`succeeded` or `failed`).
- **Tool job failure does not fail the audit.** It marks the category `not_executed` with a reason, which the gate then evaluates.
- Agent jobs are budget-scoped; exceeding budget terminates the agent cleanly and marks the audit `degraded`.
- Concurrency is capped per audit and per worker class.

### Stage 4 — Terminal determination

```ts
if (anyRequiredCategoryNotExecuted) status = 'partial'
else if (degraded) status = 'partial'
else if (allJobsFailed) status = 'failed'
else status = 'completed'
```

## 4. Budgets

Enforced by the orchestrator, not by the agents. Agents are informed of remaining budget so they can prioritise, but cannot raise it.

| Budget | Default (full audit) | Enforcement point |
|---|---|---|
| `max_total_tokens` | 2,000,000 | AI layer, per call |
| `max_agent_calls` | 120 | Agent runtime loop |
| `max_wall_minutes` | 90 | Orchestrator watchdog |
| `max_requests_to_target` | 5,000 | Scope validator, counted per `ToolExecution` |
| `max_requests_per_second` | 10 | Token bucket in worker |
| `max_concurrent_agents` | 2 | Queue concurrency |
| `max_repository_context_bytes` | 400,000 | Context builder |

Token and call budgets protect cost. **Request and rate budgets protect the customer's system** — they are the difference between an audit and an incident, and they are not optional once Katana is in the stack.

### Budget states

| State | Threshold | Orchestrator behaviour |
|---|---|---|
| GREEN | < 50% | Normal |
| YELLOW | 50–80% | Skip optional AI enrichment; prefer deterministic tools |
| RED | > 80% | Stop discovery, finish normalization/correlation/report only |
| EXCEEDED | 100% | Terminate agents cleanly, mark `degraded` |

Any transition to YELLOW or beyond sets `Audit.degraded = true` and appends to `degradationReasons`. Because findings then depend on budget state, and the gate depends on findings, a degraded audit **cannot** return PASS. This closes the loop that would otherwise let an overrun become a green build.

## 5. Retries and resumability

| Failure | Policy |
|---|---|
| Transient tool failure (exit != 0, network) | Retry ×2 with backoff |
| Timeout | Retry ×1 at 1.5× timeout, then `timed_out` |
| Worker crash | Job requeued once |
| Orchestrator crash | Audit resumes from last terminal job on restart |
| LLM provider error | Retry ×3 with backoff, then degrade that stage |

Resumability requires that every job be idempotent with respect to persisted output. Jobs write evidence with content-addressed keys (`sha256`), so a re-run overwrites identically rather than duplicating.

## 6. Concurrency

- One audit per `(project, target, commitSha)` at a time. A second request returns the running audit rather than starting a duplicate.
- Global cap of 2 concurrent audits per instance (browser workers dominate memory).
- Per-target rate limiting is **global across audits** — two audits against one staging host must not sum to 2× the agreed RPS.

## 7. Cancellation

`POST /audits/:id/cancel` sets a cancellation flag observed by:

- the queue (drains pending jobs),
- running workers (SIGTERM, 30s grace),
- the agent loop (checked between tool calls).

Partial evidence and findings are preserved. No gate evaluation is produced for a cancelled audit.

## 8. What the orchestrator emits

Every stage transition emits an OpenTelemetry span and a structured log line carrying `auditId`, `jobId`, `category`, and budget state. See [18 — Observability](../18-observability/README.md).

---

**Next:** [05 — Agent Runtime](../05-agent-runtime/README.md)
