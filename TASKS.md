# Kase — Delivery Checklist

Executable form of [19 — Roadmap](docs/19-roadmap/README.md). Ordered by dependency; milestone exit criteria are themselves checkboxes and are the only real gates.

**Legend:** `[x]` done · `[~]` partially done · `[ ]` not started · **⚠** blocks other work

**What "done" means from M4 on:** `[x]` = implemented, with passing local tests (unit, contract, or loopback). It does **not** mean live-proven. Live proof is tracked only by the exit criteria and by the gate ledgers ([GATES-M4.md](GATES-M4.md), [GATES-M5.md](GATES-M5.md)). No M4–M7 exit criterion has passed yet, mainly because the live Compose proofs need Docker and provider keys, which this machine doesn't have.

**130 tasks, 91 done, 8 partial** (as of 2026-11-26). Counts are derived from milestone and invariant checkboxes, including exit criteria; the five deferred items are excluded.

| | Phase 0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 | Invariants |
|---|---|---|---|---|---|---|---|---|---|
| Done | 15 | 16 | 18 | 9 | 10 | 11 | 12 | 0 | 0 |
| Partial | – | – | – | – | 3 | 0 | 2 | 3 | – |
| Total | 15 | 16 | 18 | 9 | 15 | 14 | 16 | 19 | 8 |
| Exit proven | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | – |

The implementation plan for what's left is in [PLAN-M4-M7.md](PLAN-M4-M7.md).

---

## Phase 0 — Decisions and de-risking

Non-code work that blocks code. ADR-017 closes the provider decision; M4 implementation and behavioral proofs are reopened.

- [x] **Semgrep ruleset licensing review** — [ADR-015](docs/20-adr/README.md#adr-015--ship-kase-rules-never-semgrep-registry-rules)
  - [x] Enumerate the exact rulesets Kase intends to ship
  - [x] Record the commercial redistribution decision from published upstream terms without claiming external legal advice
  - [x] Decide: first-party Kase rules plus tenant-scoped customer-supplied packs; no Semgrep Registry rules
  - [x] Confirm the SAST adapter stays engine-agnostic regardless of outcome
- [x] **Evidence retention policy** — [ADR-016](docs/20-adr/README.md#adr-016--bounded-retention-and-mandatory-capture-time-redaction)
  - [x] Default retention window per evidence type (traces and screenshots are the expensive ones)
  - [x] PII position: mandatory capture-time baseline; unsafe binary evidence is dropped and degrades the audit
  - [x] Organization defaults plus project overrides; hard-delete bytes and retain a safe metadata tombstone
- [x] **LLM provider contract and rate limits** — ADR-017; implementation verification tracked in M4
- [x] **Secrets management** — portable `KeyEncryptionProvider`, local development KEK, production cloud KMS seam; envelope encryption confirmed
- [x] **Correlation spike** — [`spike/correlation/`](spike/correlation/README.md), 11/11 passing
- [x] **Technical documentation and PRD reconciliation** — `docs/` is source of truth
- [x] **Extend spike to FastAPI** — decorator routing suggests parity, but that is a hypothesis, not a result. Do this before committing M5's estimate.
- [x] **Name the repo/product consistently in code** — CLI namespace `kase`, package scope decided

---

## M1 — Skeleton (weeks 1–3)

**Goal:** a job runs in a sandboxed worker and writes evidence to object storage.

### Platform
- [x] NestJS API scaffold with module boundaries matching the five subsystems
- [x] Prisma schema from [03 — Data Model](docs/03-data-model/README.md), migrations committed — 26 models, initial migration applied successfully against live PostgreSQL
- [x] BullMQ + Redis wiring, queue topology, concurrency caps from [02 §7](docs/02-stack/README.md#7-concurrency-and-resource-defaults) — 7 queues by job kind, caps + per-queue timeouts, 19 tests
- [x] MinIO/S3 client, bucket layout, content-addressed paths — bucket now created by a `minio-init` service
- [x] Docker Compose: Postgres, Redis, MinIO, fixture target — volumes, healthchecks, and a working fixture entrypoint

### Entities and auth
- [x] CRUD for Project, Repository, Target, ScopePolicy — ULIDs, RFC 9457 errors, cursor pagination, audit trail with diffs; 112 tests
- [x] Auth.js in Next, JWT verification in NestJS, `ProjectScopeGuard` — `apps/web` with GitHub/Google/Apple, invite-only provisioning, RS256 Next→Nest exchange; Nest side: single `AuthGuard`, deny-by-default `ProjectScopeGuard`, flat-role `RolesGuard`; 88 tests across both apps
- [x] Project API tokens for CLI/CI, hashed at rest — SHA-256, `POST/GET/DELETE /projects/:id/tokens`, plaintext returned once, revoked not deleted
- [x] Secret storage with envelope encryption; rotation and revocation as API operations — metadata-only admin API, immutable versions, 32-byte local KEK provider

### Worker isolation
- [x] `worker-base` image: non-root, seccomp profile, pinned versions — live agent profile verified at UID `10001`
- [x] Per-family images (`recon`, `browser`, `sast`, `deps`, `agent`) — stages build successfully in the Compose proof
- [x] Egress policy per image — recon-only proxy network enforced; denied destination recorded by the audit trail and Squid; agent has no target or proxy reachability
- [x] Secret injection via env/tmpfs, never baked into images or Redis payloads — unit and live-container checks pass
- [x] Promote the spike fixture into `fixtures/vulnerable-app/` with Compose wiring

**Exit criteria**
- [x] A job dispatched via the API runs in a sandboxed worker and persists hashed evidence to object storage — MinIO bytes independently hash to `Evidence.sha256`
- [x] A worker denied egress to a non-allowlisted host fails closed and logs the denial — failed audit, audit-trail event, and matching Squid denial verified

---

## M2 — Deterministic spine (weeks 4–6)

**Goal:** a Semgrep-only audit produces normalized, severity-assigned findings with evidence. **No AI involved yet.**

### Orchestration
- [x] Audit state machine — `queued → running → completed | partial | failed | cancelled` ([04](docs/04-orchestrator/README.md))
- [x] Job graph with `dependsOn`, retries (max 2), per-adapter timeouts
- [x] Resumability and partial-result preservation
- [x] `degraded` flag and `degradationReasons` plumbed onto Audit
- [x] Cancellation that actually stops workers

### Build provenance ⚠
- [x] Resolution from all four sources: `ci_supplied`, `build_info_endpoint`, `response_header`, `assumed`
- [x] Mismatch between CI SHA and target-reported SHA → refuse to verify
- [x] `verified: false` propagates to every correlation in the audit

### Evidence store
- [x] Content addressing, SHA-256 on write, immutability enforced
- [x] Capture-time redaction with a registered-secret redactor ([08 §5](docs/08-evidence/README.md#5-redaction))
- [x] Size caps and truncation with full-content hashing ([08 §6](docs/08-evidence/README.md#6-size-limits-and-truncation))
- [x] `replayable` classification set at capture, not inferred later

### Findings
- [x] `NormalizedFinding` shape and the normalizer
- [x] Severity engine with category floors — adapters never set severity
- [x] `http` adapter (replayable exchanges)
- [x] `semgrep` adapter with enclosing-symbol resolution from the AST
- [x] CLI: `kase audit start`, `kase findings list`

**Exit criteria**
- [x] A Semgrep-only audit against the fixture produces normalized findings with authoritative severity and replayable evidence, with zero AI calls

---

## M3 — Recon and inventory (weeks 7–8)

**Goal:** a crawl produces a canonical inventory; out-of-scope URLs are denied and logged.

- [x] `katana` adapter
- [x] `httpx` adapter with tech fingerprinting
- [x] **⚠ Scope validator on every discovered URL** — discovery must never be a scope-escalation path ([06 §5](docs/06-recon/README.md#5-every-discovered-url-re-enters-the-scope-validator))
- [x] Path-template normalization (`/api/invoices/123` → `/api/invoices/{id}`)
- [x] Inventory merge across discovery sources with provenance per endpoint
- [x] Persisted `EndpointInventory` — first-class, not transient
- [x] Cross-audit endpoint drift (appeared/disappeared) as a reportable signal
- [x] Global per-host rate limiting, `maxRequestsPerAudit` enforcement

**Exit criteria**
- [x] Crawl of the fixture yields a canonical inventory; an out-of-scope URL discovered mid-crawl is denied, logged, and never probed

---

## M4 — Agent runtime (weeks 9–12)

**Goal:** the black-box agent finds the seeded IDOR unaided and files a schema-valid finding.

> **Status:** code complete locally; GATES-M4 local checks L1–L4 pass (28 / 25 / 24 cases, zero skips). Live gates G1–G6 are pending: no Docker engine, no provider keys. See [M4-REPAIR-REPORT.md](M4-REPAIR-REPORT.md).

### Provider layer
- [x] `AIProvider` abstraction, model pinning, prompt caching — Anthropic, OpenAI and Gemini adapters; Anthropic sets cache control, the other two report cached tokens; loopback HTTP/SSE contract suite (L1)
- [~] Token/call/wall-clock budget accounting per audit — `budget.service.ts` with reservations and settlement; local L2 passes; the PostgreSQL concurrency proof (`scripts/m4-database-proof.mjs`) hasn't run
- [x] GREEN/YELLOW/RED degradation ladder ([11](docs/11-ai-layer/README.md)) — transitions are recorded as `budget.transition` audit events
- [x] **Degradation sets `degraded: true`** — a budget overrun must never silently become a green build

### Capability contract ⚠
- [x] Typed capabilities only — no shell passthrough, no command-shaped `request_tool` (L3)
- [x] `create_finding`, `attach_evidence`, `get_source`, `get_route_map`
- [x] `record_passing_check` — distinguishes "tested and clean" from "never tested"
- [x] `report_blocked` — required for the "category failed to execute" gate condition
- [x] `request_scope_change` — denied and logged, never silently honored (`agent.scope_change.denied` audit-trail event)
- [x] Schema validation on every agent output with structured error feedback and bounded retries

### Methodology
- [x] Vendor `references/` payloads from both `.skill` archives as the methodology corpus
- [~] Black-box agent loop over the endpoint inventory — implemented and tested against a deterministic provider fixture; no live run yet (G5/G6)
- [~] White-box agent loop over the code map — implemented; no live run yet

**Exit criteria**
- [ ] The black-box agent independently discovers the seeded IDOR and files a schema-valid finding carrying replayable evidence — GATES-M4 G6 (real provider), blocked on keys and Docker
- [ ] An agent attempting an out-of-scope action is denied, and the denial appears in the audit log — denial path is unit-tested; live containment is GATES-M4 G3/G5

---

## M5 — Correlation (weeks 13–15)

**Goal:** black-box and white-box findings merge into one correlated finding with a verified source location. **This is the thesis proven.**

> Several assumptions here are already validated by [`spike/correlation/`](spike/correlation/README.md) — route dump, the controller→service walk, symbol-keyed fingerprints, and reachability filtering. This milestone is largely hardening and generalizing that work, not discovering it.

> **Status:** everything that can be built without Docker is done. GATES-M5 G1–G3, G5 (dedup, 51 tests), G6 (lifecycle, 56 tests) and G7 (571 API tests plus `tsc`) pass. G4, durable integration through real workers and the live proof of both exit criteria, is pending on Docker. Layer-4 AI correlation is not started.

- [x] `kase-routemap` for NestJS — runtime dump of the live DI container (`adapters/routemap/nest-route-dump.ts`, runner `routemap-nest-main.ts`), bound to source by `nestSymbolLocator` (G3). Worker-image packaging is part of G4
- [x] `kase-routemap` for FastAPI — `workers/routemap/fastapi_dump.py` dumps `app.routes`, bound to source by `python-symbols.ts` (G3)
- [x] OpenAPI spec ingest as a deterministic source, ranked above static parse — commit-bound `kase.routemap/v1` envelope, and `assembleRoutes` records rejected artifacts as failures (G3)
- [x] Code map builder with symbol resolution — bounded depth, cycles and node counts (G2)
- [x] Correlation layers 1–3 with `method` recorded per correlation (G1)
- [x] **Reachability filtering** — static findings on unreachable code must not correlate (G1 negative controls)
- [ ] Layer 4 AI inference as **advisory only**, ordinal confidence, never numeric thresholds
- [x] Fingerprinting on deterministic inputs only — SHA-256 over structural inputs in `correlation-engine.service.ts`
- [x] Three-level dedup: exact → semantic → AI-assisted, emitting `MATCH`/`POSSIBLE_MATCH`/`NEW_FINDING` — `findings/dedup.ts` + `runDedup`, wired into agent `create_finding`; the AI advisor port defaults to proposing nothing (G5)
- [x] `POSSIBLE_MATCH` routes to a human queue, never auto-resolves — `GET /projects/:id/dedup-queue`, `POST …/:relationId/decision` (approver/admin), `kase dedup list|decide`; rejected pairs are never re-proposed (G5)
- [x] Finding lifecycle: `NEW`, `OPEN`, `FIXED`, `VERIFIED`, `REGRESSED`, `NOT_REPRODUCED`, `FALSE_POSITIVE`, `ACCEPTED_RISK` — `findings/lifecycle.ts` transition table, `POST /projects/:id/finding-identities/:identityId/transition`, `kase findings transition`, and observation applied on audit settlement (G6)
- [x] Suppression store keyed on fingerprint, fed by `FALSE_POSITIVE` — the false_positive decision creates exactly one suppression, and reopen removes it (G6)

**Exit criteria**
- [ ] The fixture's IDOR produces exactly one correlated finding pointing at the service method, with both evidence artifacts preserved — proven in unit tests against the real fixture source; not yet through real workers (G4)
- [ ] Removing build provenance downgrades it to advisory without losing the finding — the gate engine does the downgrade; end-to-end proof is G4

---

## M6 — Release assurance (weeks 16–18)

**Goal:** the vertical slice blocks a PR and explains itself.

> **Status:** gate core, policy and waivers are committed (`47e8f74`, `fab9e90`, `9fe2706`, `cfb4825`, `cc6a6e4`). Still missing: the live replay adapter, report generation, the GitHub App and Actions. There is no GATES-M6 ledger yet.

### Gate ⚠
- [x] Policy engine with per-project configurable policies — DSL schema, pure deterministic `gate-engine.ts`, versioned `GatePolicy` CRUD
- [x] **Evidence-class gating** — only replayable artifacts can block; AI-only findings warn ([ADR-002](docs/20-adr/README.md)) — `evidence-classification.ts`; non-replayable matches are downgraded to warnings
- [~] Replay verification before any block — `ReplayVerifier` port is wired, and its default fails closed (returns `error`, so the block stands); the real sandboxed HTTP re-issue adapter isn't built
- [x] Gate outcomes: `PASS`, `FAIL`, `PARTIAL` — **`PARTIAL` is never `PASS`** ([ADR-007](docs/20-adr/README.md))
- [x] Fail closed on orchestrator crash, worker timeout, or required category not executed — enforced at gate evaluation (`notExecutedCategories`, degraded audits)
- [x] Gate result records policy used, blocking finding IDs, audit ID, commit SHA, timestamp — `GateEvaluation` model

### Waivers
- [x] Fingerprint-scoped, never finding-ID-scoped
- [x] Mandatory expiry — no permanent ignore (`max_duration_days`, default 30)
- [x] Requester ≠ approver as configurable policy (`require_separate_approver`)
- [x] Expiry warnings surfaced ~7 days ahead in report and integrations — `warn_before_expiry_days` (default 7) drives the report's ⚠ waiver table and the PR comment's waiver lines; the CLI shows days remaining

### Output
- [x] Report generation following the skills' report structure, executive summary built last — `assurance/report/`: Markdown folder and JSON via `GET /audits/:id/report?format=json|markdown`, `kase report get --out`; golden-file tested, not yet run against a live audit (HTML not built)
- [x] GitHub App: PR comment, check run — `integrations/github/`: signed webhook, PR → audit at head SHA → `Kase gate` check run (PARTIAL never `success`) with verified-only annotations, one comment upserted in place, OAuth-verified install binding, fork PRs off by default; contract-tested against a fake GitHub, not yet run against a real installation
- [~] GitHub Actions workflow and published action — `.github/actions/kase-gate` (composite, exit codes follow the CLI, fails closed) and an example workflow in `docs/13-integrations/examples/`; not yet tagged or published
- [x] `kase gate evaluate` with explainable output — cites rule, evidence, source location (also `kase gate show`; exit code follows the outcome)

**Exit criteria**
- [ ] A PR against the fixture is blocked by the correlated finding, and the check run explains why in terms a developer can act on
- [ ] Fixing the fixture flips the same PR to green

---

## M7 — Surface (weeks 19–22)

**Goal:** a real project can be onboarded and run without operator assistance.

> **Status:** dashboard shell has started (`e6f95a8`). Audits list, audit detail, findings and gate panel read the real API through `lib/kase-api`, and there's a dev-only fixture preview. Nothing else in M7 has started. Outside this checklist, the marketing landing page, waitlist and brand system (`1b1665e`) and the security-audit import (`kase import security-audit`) are built.

### Dashboard
- [ ] Projects list and detail
- [~] Audit detail with live progress over SSE — audit detail page exists; the API has an SSE endpoint (`audit-events.controller.ts`), but the page doesn't subscribe to it
- [~] Findings list with severity/category/status filters — list page exists; filters not verified
- [ ] Finding detail: evidence viewer, correlation chain, source excerpt
- [~] Gate status and history — `gate-panel.tsx` shows the current outcome; no history
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
