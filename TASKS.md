# Kase — Delivery Checklist

Executable form of [19 — Roadmap](docs/19-roadmap/README.md). Ordered by dependency; milestone exit criteria are themselves checkboxes and are the only real gates.

**Legend:** `[x]` done · `[~]` partially done · `[ ]` not started · **⚠** blocks other work

**130 tasks, 10 done.** Counts include milestone exit criteria, which are the real gates.

| | Phase 0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 | Invariants |
|---|---|---|---|---|---|---|---|---|---|
| Done | 4 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Total | 15 | 16 | 18 | 9 | 15 | 14 | 16 | 19 | 8 |

---

## Phase 0 — Decisions and de-risking

Non-code work that blocks code. Start the legal item this week; it has the longest lead time.

- [ ] **⚠ Semgrep ruleset licensing review** — [02 §3](docs/02-stack/README.md#3-open-item-semgrep-licensing)
  - [ ] Enumerate the exact rulesets Kase intends to ship
  - [ ] Legal opinion on redistribution in a commercial product
  - [ ] Decide: first-party rules · permissive community rules · customer-supplied entitlement
  - [ ] Confirm the SAST adapter stays engine-agnostic regardless of outcome
- [ ] **⚠ Evidence retention policy** — blocks M2 storage design
  - [ ] Default retention window per evidence type (traces and screenshots are the expensive ones)
  - [ ] PII position: what may be captured, what must be redacted at capture
  - [ ] Customer-configurable override, and whether deletion is hard or soft
- [ ] **LLM provider contract and rate limits** — blocks M4 budget design
- [ ] **Secrets management** — recommend KMS envelope encryption per [02 §4](docs/02-stack/README.md#4-secrets-management-is-a-first-class-requirement); confirm or override
- [x] **Correlation spike** — [`spike/correlation/`](spike/correlation/README.md), 11/11 passing
- [x] **Technical documentation and PRD reconciliation** — `docs/` is source of truth
- [x] **Extend spike to FastAPI** — decorator routing suggests parity, but that is a hypothesis, not a result. Do this before committing M5's estimate.
- [x] **Name the repo/product consistently in code** — CLI namespace `kase`, package scope decided

---

## M1 — Skeleton (weeks 1–3)

**Goal:** a job runs in a sandboxed worker and writes evidence to object storage.

### Platform
- [x] NestJS API scaffold with module boundaries matching the five subsystems
- [x] Prisma schema from [03 — Data Model](docs/03-data-model/README.md), migrations committed — 26 models, initial migration generated offline via `migrate diff`; **not yet applied against a live Postgres**
- [x] BullMQ + Redis wiring, queue topology, concurrency caps from [02 §7](docs/02-stack/README.md#7-concurrency-and-resource-defaults) — 7 queues by job kind, caps + per-queue timeouts, 19 tests
- [x] MinIO/S3 client, bucket layout, content-addressed paths — bucket now created by a `minio-init` service
- [x] Docker Compose: Postgres, Redis, MinIO, fixture target — volumes, healthchecks, and a working fixture entrypoint

### Entities and auth
- [ ] CRUD for Project, Repository, Target, ScopePolicy
- [ ] Auth.js in Next, JWT verification in NestJS, `ProjectScopeGuard`
- [ ] Project API tokens for CLI/CI, hashed at rest
- [ ] Secret storage with envelope encryption; rotation and revocation as API operations

### Worker isolation
- [ ] `worker-base` image: non-root, seccomp profile, pinned versions
- [ ] Per-family images (`recon`, `browser`, `sast`, `deps`, `agent`)
- [ ] Egress policy per image — agent worker gets **no** target egress
- [ ] Secret injection via env/tmpfs, never baked into images or Redis payloads
- [x] Promote the spike fixture into `fixtures/vulnerable-app/` with Compose wiring

**Exit criteria**
- [ ] A job dispatched via the API runs in a sandboxed worker and persists hashed evidence to object storage
- [ ] A worker denied egress to a non-allowlisted host fails closed and logs the denial

---

## M2 — Deterministic spine (weeks 4–6)

**Goal:** a Semgrep-only audit produces normalized, severity-assigned findings with evidence. **No AI involved yet.**

### Orchestration
- [ ] Audit state machine — `queued → running → completed | partial | failed | cancelled` ([04](docs/04-orchestrator/README.md))
- [ ] Job graph with `dependsOn`, retries (max 2), per-adapter timeouts
- [ ] Resumability and partial-result preservation
- [ ] `degraded` flag and `degradationReasons` plumbed onto Audit
- [ ] Cancellation that actually stops workers

### Build provenance ⚠
- [ ] Resolution from all four sources: `ci_supplied`, `build_info_endpoint`, `response_header`, `assumed`
- [ ] Mismatch between CI SHA and target-reported SHA → refuse to verify
- [ ] `verified: false` propagates to every correlation in the audit

### Evidence store
- [ ] Content addressing, SHA-256 on write, immutability enforced
- [ ] Capture-time redaction with a registered-secret redactor ([08 §5](docs/08-evidence/README.md#5-redaction))
- [ ] Size caps and truncation with full-content hashing ([08 §6](docs/08-evidence/README.md#6-size-limits-and-truncation))
- [ ] `replayable` classification set at capture, not inferred later

### Findings
- [ ] `NormalizedFinding` shape and the normalizer
- [ ] Severity engine with category floors — adapters never set severity
- [ ] `http` adapter (replayable exchanges)
- [ ] `semgrep` adapter with enclosing-symbol resolution from the AST
- [ ] CLI: `kase audit start`, `kase findings list`

**Exit criteria**
- [ ] A Semgrep-only audit against the fixture produces normalized findings with authoritative severity and replayable evidence, with zero AI calls

---

## M3 — Recon and inventory (weeks 7–8)

**Goal:** a crawl produces a canonical inventory; out-of-scope URLs are denied and logged.

- [ ] `katana` adapter
- [ ] `httpx` adapter with tech fingerprinting
- [ ] **⚠ Scope validator on every discovered URL** — discovery must never be a scope-escalation path ([06 §5](docs/06-recon/README.md#5-every-discovered-url-re-enters-the-scope-validator))
- [ ] Path-template normalization (`/api/invoices/123` → `/api/invoices/{id}`)
- [ ] Inventory merge across discovery sources with provenance per endpoint
- [ ] Persisted `EndpointInventory` — first-class, not transient
- [ ] Cross-audit endpoint drift (appeared/disappeared) as a reportable signal
- [ ] Global per-host rate limiting, `maxRequestsPerAudit` enforcement

**Exit criteria**
- [ ] Crawl of the fixture yields a canonical inventory; an out-of-scope URL discovered mid-crawl is denied, logged, and never probed

---

## M4 — Agent runtime (weeks 9–12)

**Goal:** the black-box agent finds the seeded IDOR unaided and files a schema-valid finding.

### Provider layer
- [ ] `AIProvider` abstraction, model pinning, prompt caching
- [ ] Token/call/wall-clock budget accounting per audit
- [ ] GREEN/YELLOW/RED degradation ladder ([11](docs/11-ai-layer/README.md))
- [ ] **Degradation sets `degraded: true`** — a budget overrun must never silently become a green build

### Capability contract ⚠
- [ ] Typed capabilities only — no shell passthrough, no command-shaped `request_tool`
- [ ] `create_finding`, `attach_evidence`, `get_source`, `get_route_map`
- [ ] `record_passing_check` — distinguishes "tested and clean" from "never tested"
- [ ] `report_blocked` — required for the "category failed to execute" gate condition
- [ ] `request_scope_change` — denied and logged, never silently honored
- [ ] Schema validation on every agent output with structured error feedback and bounded retries

### Methodology
- [ ] Vendor `references/` payloads from both `.skill` archives as the methodology corpus
- [ ] Black-box agent loop over the endpoint inventory
- [ ] White-box agent loop over the code map

**Exit criteria**
- [ ] The black-box agent independently discovers the seeded IDOR and files a schema-valid finding carrying replayable evidence
- [ ] An agent attempting an out-of-scope action is denied, and the denial appears in the audit log

---

## M5 — Correlation (weeks 13–15)

**Goal:** black-box and white-box findings merge into one correlated finding with a verified source location. **This is the thesis proven.**

> Several assumptions here are already validated by [`spike/correlation/`](spike/correlation/README.md) — route dump, the controller→service walk, symbol-keyed fingerprints, and reachability filtering. This milestone is largely hardening and generalizing that work, not discovering it.

- [ ] `kase-routemap` for NestJS — **spike-validated**, needs packaging as a real adapter
- [ ] `kase-routemap` for FastAPI
- [ ] OpenAPI spec ingest as a deterministic source, ranked above static parse
- [ ] Code map builder with symbol resolution — **spike-validated**, needs depth/cycle limits at scale
- [ ] Correlation layers 1–3 with `method` recorded per correlation
- [ ] **Reachability filtering** — static findings on unreachable code must not correlate (found by the spike, not in the original design)
- [ ] Layer 4 AI inference as **advisory only**, ordinal confidence, never numeric thresholds
- [ ] Fingerprinting on deterministic inputs only — **spike-validated**
- [ ] Three-level dedup: exact → semantic → AI-assisted, emitting `MATCH`/`POSSIBLE_MATCH`/`NEW_FINDING`
- [ ] `POSSIBLE_MATCH` routes to a human queue, never auto-resolves
- [ ] Finding lifecycle: `NEW`, `OPEN`, `FIXED`, `VERIFIED`, `REGRESSED`, `NOT_REPRODUCED`, `FALSE_POSITIVE`, `ACCEPTED_RISK`
- [ ] Suppression store keyed on fingerprint, fed by `FALSE_POSITIVE`

**Exit criteria**
- [ ] The fixture's IDOR produces exactly one correlated finding pointing at the service method, with both evidence artifacts preserved
- [ ] Removing build provenance downgrades it to advisory without losing the finding

---

## M6 — Release assurance (weeks 16–18)

**Goal:** the vertical slice blocks a PR and explains itself.

### Gate ⚠
- [ ] Policy engine with per-project configurable policies
- [ ] **Evidence-class gating** — only replayable artifacts can block; AI-only findings warn ([ADR-002](docs/20-adr/README.md))
- [ ] Replay verification before any block
- [ ] Gate outcomes: `PASS`, `FAIL`, `PARTIAL` — **`PARTIAL` is never `PASS`** ([ADR-007](docs/20-adr/README.md))
- [ ] Fail closed on orchestrator crash, worker timeout, or required category not executed
- [ ] Gate result records policy used, blocking finding IDs, audit ID, commit SHA, timestamp

### Waivers
- [ ] Fingerprint-scoped, never finding-ID-scoped
- [ ] Mandatory expiry — no permanent ignore
- [ ] Requester ≠ approver as configurable policy
- [ ] Expiry warnings surfaced ~7 days ahead in report and integrations

### Output
- [ ] Report generation following the skills' report structure, executive summary built last
- [ ] GitHub App: PR comment, check run
- [ ] GitHub Actions workflow and published action
- [ ] `kase gate evaluate` with explainable output — cites rule, evidence, source location

**Exit criteria**
- [ ] A PR against the fixture is blocked by the correlated finding, and the check run explains why in terms a developer can act on
- [ ] Fixing the fixture flips the same PR to green

---

## M7 — Surface (weeks 19–22)

**Goal:** a real project can be onboarded and run without operator assistance.

### Dashboard
- [ ] Projects list and detail
- [ ] Audit detail with live progress over SSE
- [ ] Findings list with severity/category/status filters
- [ ] Finding detail: evidence viewer, correlation chain, source excerpt
- [ ] Gate status and history
- [ ] Waiver management with expiry visibility
- [ ] Endpoint inventory with cross-audit drift

### Integrations and breadth
- [ ] Jira: issue creation, severity mapping, evidence attachment
- [ ] **Jira dedup keyed on fingerprint** — no duplicate tickets across audits
- [ ] `nuclei` adapter (deterministic, gate-eligible)
- [ ] `gitleaks` adapter
- [ ] `deps` adapter (`npm audit`, `pip-audit`, OSV)
- [ ] `axe` and `lighthouse` adapters — Lighthouse advisory by default
- [ ] Regression audit mode

### Observability
- [ ] Metrics: audit/job duration, tool failures, finding counts, LLM spend, queue depth
- [ ] OpenTelemetry traces across API → queue → worker
- [ ] Alerting on gate flapping and agent failure rate

**Exit criteria**
- [ ] A project other than the fixture is onboarded end to end by someone who did not build Kase
- [ ] Two consecutive audits of an unchanged commit produce identical fingerprints and identical gate outcomes

---

## Deferred — do not start

Cut with reasons in [19 §5](docs/19-roadmap/README.md#5-cut-list-with-reasons). Listed so they stay visibly out of scope.

- [ ] ~~`ffuf`~~ — needs a hard authorization gate and soft-404 calibration
- [ ] ~~`gau`~~ — third-party egress; wait for scope-validator mileage
- [ ] ~~k6 load testing~~ — highest incident risk, rarely gate-blocking
- [ ] ~~Express route parsing~~ — runtime dump solves it better
- [ ] ~~Multi-tenant governance, self-healing, visual regression, device farms~~

---

## Standing invariants

Check these hold at every milestone, not once.

- [ ] No AI-emitted number is ever compared against a threshold
- [ ] No AI output is persisted without schema validation
- [ ] No tool sets its own severity
- [ ] No agent executes a command; it requests a typed capability
- [ ] No discovered URL is probed before re-entering the scope validator
- [ ] No credential value reaches a log, evidence artifact, or job payload
- [ ] No degraded or partial audit can produce `PASS`
- [ ] No fingerprint input is AI-authored prose or a line number
