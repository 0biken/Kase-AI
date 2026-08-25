# 01 — Architecture

System architecture, pipeline ordering, and the reasoning behind the ordering.

---

## 1. System diagram

```
                              KASE
                                |
                    +-----------v-----------+
                    |     API / Web App     |
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |  AUDIT ORCHESTRATOR   |  owns state, scheduling, budgets
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |   BUILD PROVENANCE    |  binds target build <-> source commit
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |     RECON ENGINE      |  Katana / httpx / Playwright
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |  ENDPOINT INVENTORY   |  persisted, first-class
                    +-----------+-----------+
                                |
             +------------------+------------------+
             v                  v                  v
      Black Box Agent    White Box Agent      Tool Runner
             |                  |                  |
             +------------------+------------------+
                                v
                    +-----------------------+
                    |    EVIDENCE STORE     |  immutable, hashed, replayable
                    +-----------+-----------+
                                v
                    +-----------------------+
                    |  FINDING NORMALIZER   |
                    +-----------+-----------+
                                v
                    +-----------------------+
                    |     INGEST DEDUP      |  exact-match only, cheap
                    +-----------+-----------+
                                v
                    +-----------------------+
                    |  CORRELATION ENGINE   |  attaches source locations
                    +-----------+-----------+
                                v
                    +-----------------------+
                    | FINGERPRINT + DEDUP   |  semantic + cross-audit history
                    +-----------+-----------+
                                v
                    +-----------------------+
                    |      AI REVIEW        |  advisory; cannot overwrite evidence
                    +-----------+-----------+
                                v
             +------------------+------------------+
             v                  v                  v
          REPORT              JIRA              GITHUB
             |                  |                  |
             +------------------+------------------+
                                v
                    +-----------------------+
                    |     POLICY ENGINE     |  deterministic, evidence-class based
                    +-----------+-----------+
                                v
                    +-----------------------+
                    |     RELEASE GATE      |  PASS / FAIL / PARTIAL
                    +-----------------------+
```

## 2. Pipeline ordering — why it is this order

Three ordering decisions carry most of the design weight.

### 2.1 Build provenance comes before everything

The correlation engine claims a live endpoint maps to `invoice.controller.ts:84`. But the audit probed a **deployment** and parsed a **checkout**. If those are not the same build, correlation produces confidently wrong source locations — strictly worse than producing none.

Every audit therefore resolves a `BuildProvenance` record before any agent runs. If the SHA cannot be established, correlation results are marked `unverified` and are **never gate-eligible**. See [10 — Correlation §2](../10-correlation/README.md#2-build-provenance-binding).

### 2.2 Recon comes before the agents

The Endpoint Inventory is the join key between black-box and white-box findings. Producing it first means:

- the black-box agent works from a real route list instead of guessing,
- the white-box agent can be asked to map *specific* discovered endpoints to handlers,
- the correlation engine has one canonical target vocabulary on both sides.

### 2.3 Correlation comes before semantic dedup

Correlation is what **adds the source location**, and source location is the strongest dedup key available. Deduplicating first means deduplicating black-box findings that do not yet know where they live, then discovering afterwards that three "distinct" findings resolve to the same handler.

Dedup therefore runs in two passes:

| Pass | Position | Basis | Purpose |
|---|---|---|---|
| Ingest dedup | Before correlation | Exact `(tool, rule_id, raw_target)` | Drop literal repeats from one tool, cheaply |
| Semantic dedup | After correlation | Full fingerprint incl. source location | Cross-tool and cross-audit identity |

## 3. Five core subsystems

Everything else supports these.

| # | Subsystem | Responsibility | Docs |
|---|---|---|---|
| 1 | Audit Orchestrator | Runs the audit deterministically; owns state and budgets | [04](../04-orchestrator/README.md) |
| 2 | Agent Runtime | Hosts both agents behind a validated tool contract | [05](../05-agent-runtime/README.md) |
| 3 | Evidence + Finding Engine | Turns everything into structured, persistent, replayable data | [08](../08-evidence/README.md), [09](../09-findings/README.md) |
| 4 | Correlation Engine | Connects runtime observations to source locations | [10](../10-correlation/README.md) |
| 5 | Release Assurance | Report, Jira, GitHub, policy engine, gate | [12](../12-policy-gate/README.md), [13](../13-integrations/README.md) |

## 4. Deployment topology

```
 +--------------+   +--------------+
 |  Next.js Web |   |   Kase CLI   |
 +------+-------+   +------+-------+
        +--------+---------+
                 v
        +----------------+        +--------------+
        |   NestJS API   |------->|  PostgreSQL  |
        +--------+-------+        +--------------+
                 |                +--------------+
                 +--------------->| Redis/BullMQ |
                 |                +------+-------+
                 |                       |
                 |     +-----------------v------------------+
                 |     |      Worker pool (Docker)          |
                 |     |  +-----------+  +---------------+  |
                 |     |  | recon-wk  |  |  browser-wk   |  |
                 |     |  | Katana    |  |  Playwright   |  |
                 |     |  | httpx     |  |  axe, LH      |  |
                 |     |  +-----------+  +---------------+  |
                 |     |  +-----------+  +---------------+  |
                 |     |  | sast-wk   |  |   agent-wk    |  |
                 |     |  | Semgrep   |  |   LLM loop    |  |
                 |     |  | gitleaks  |  |               |  |
                 |     |  +-----------+  +---------------+  |
                 |     +-----------------+------------------+
                 |                       v
                 |               +--------------+
                 +-------------->|  S3 evidence |
                                 +--------------+
```

Workers are **egress-restricted per job** — see [17 — Security §4](../17-security/README.md#4-network-egress-policy).

## 5. Trust boundaries

| Boundary | Enforced by |
|---|---|
| User to API | Authentication plus project-scoped authorization |
| API to Worker | Signed job payloads; workers never accept ad-hoc commands |
| Agent to Tools | Typed capability contract; no shell passthrough |
| Worker to Target | Scope validator and rate limiter on every request |
| Worker to Internet | Per-job egress allowlist |
| AI output to system of record | Schema validation; AI proposes, never overwrites evidence |

## 6. Failure isolation

| Failure | Effect on audit | Effect on gate |
|---|---|---|
| One tool crashes | Job marked `failed`, audit continues | Category marked `not_executed` -> gate FAIL if category was required |
| Agent exceeds budget | Audit marked `partial` | Gate outcome PARTIAL, never PASS |
| Worker timeout | Job retried up to `max_retries`, then `failed` | As above |
| Target unreachable | Black-box categories `not_executed` | Gate FAIL (fail closed) |
| Orchestrator crash | Audit resumable from last completed job | Gate FAIL until re-run completes |

The gate **fails closed**. Infrastructure failure is never a PASS.

---

**Next:** [02 — Technology Stack](../02-stack/README.md)
