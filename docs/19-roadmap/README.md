# 19 — Roadmap

The first vertical slice, milestones, priorities, and what is deliberately cut.

---

## 1. The sequencing principle

Kase has one claim to prove: *a running system and its source can be audited together and correlated into a release decision.* Every milestone is ordered by how directly it tests that claim.

Adapter breadth does not test it. One endpoint, correlated end to end, does.

## 2. The first vertical slice

**Goal:** one seeded IDOR, discovered from outside, traced to source, blocking a build — with no manual step between stages.

### Fixture

A deliberately vulnerable NestJS app in `fixtures/vulnerable-app/`, shipped in Docker Compose:

```ts
// src/invoices/invoice.service.ts
async find(id: string) {
  return this.prisma.invoice.findUnique({ where: { id } })   // no ownership predicate
}
```

NestJS is chosen deliberately: decorator-based routing is statically tractable and supports a runtime route dump, so the correlation path can be proven without first solving Express.

> **This slice has been spiked and passes.** A standalone, runnable proof of the full path — route dump, controller→service walk, static rule, join, fingerprint, gate — lives in [`spike/correlation/`](../../spike/correlation/README.md). It validates M5's core assumptions ahead of M1 and records what it found, including that reachability must be part of the join and that Express's router cannot supply the handler symbol.

### The path that must work

```
1. Project + target + repo + ScopePolicy created
2. Audit started with --commit  -> BuildProvenance verified: true
3. Katana crawls                -> /api/invoices/123 discovered
4. Normalization                -> /api/invoices/{id} in Endpoint Inventory
5. Black-box agent, two test accounts
                                -> requests A's invoice with B's token
                                -> 200 -> create_finding + http_exchange evidence
6. kase-routemap                -> /api/invoices/:id -> InvoiceController.findOne
7. Code map walk                -> findOne -> InvoiceService.find
8. Semgrep / white-box agent    -> missing ownership predicate at InvoiceService.find
9. Correlation                  -> method=runtime_dump, verified=true
10. Fingerprint + merge         -> ONE finding, both artifacts
11. Severity engine             -> critical (IDOR floor)
12. Gate                        -> replay reproduces -> BLOCK
13. CLI                         -> exit 1, cites rule + evidence + source
```

### Done when

- The full path runs headless from `kase audit start` to a non-zero exit.
- Correlation is `verified: true` and points at `InvoiceService.find`, not the controller.
- Fixing the fixture and re-running produces `fixed` and exit 0.
- Removing `--commit` produces an unverified provenance warning and a non-blocking correlated finding.

That last check matters as much as the happy path — it proves the safety property, not just the feature.

## 3. Milestones

### M1 — Skeleton (weeks 1–3)

- NestJS API, Prisma schema, BullMQ, MinIO, Compose
- Projects, targets, repositories, scope policies
- Auth: Auth.js in Next, JWT verification in Nest, project API tokens
- Secret storage with envelope encryption
- Worker base images, egress policy, non-root hardening
- Vulnerable fixture app

The application slice is implemented. Live container acceptance remains open until the local Docker Linux engine is available; static security checks and API tests do not substitute for the Compose exit criterion.

**Exit:** a job runs in a sandboxed worker and writes evidence to object storage.

### M2 — Deterministic spine (weeks 4–6)

- Audit state machine, job graph, retries, resumability
- Build provenance resolution with all four sources
- Evidence store: content addressing, hashing, capture-time redaction
- Finding schema, normalizer, severity engine with floors
- `http` and `semgrep` adapters
- CLI: `audit start`, `findings list`

**Exit:** a semgrep-only audit produces normalized, severity-assigned findings with evidence. No AI involved yet.

### M3 — Recon and inventory (weeks 7–8)

- Katana and httpx adapters
- Scope validator on every discovered URL
- Path-template normalization and inventory merge
- Persisted `EndpointInventory` with cross-audit drift
- Global per-host rate limiting

**Exit:** a crawl produces a canonical inventory; out-of-scope URLs are denied and logged.

### M4 — Agent runtime (weeks 9–12)

- Provider abstraction, model pinning, prompt caching
- Typed capability contract; no shell passthrough
- Agent loop with schema validation and structured error feedback
- `create_finding`, `attach_evidence`, `record_passing_check`, `report_blocked`, `request_scope_change`
- Methodology payload vendored from the two skills' `references/`
- Budget enforcement and the degradation ladder

**Exit:** the black-box agent finds the seeded IDOR unaided and files a schema-valid finding with replayable evidence.

### M5 — Correlation (weeks 13–15)

- `kase-routemap` for NestJS and FastAPI
- OpenAPI ingest
- Code map builder with symbol resolution
- Correlation engine, layers 1–3
- Fingerprinting and three-level dedup
- Finding lifecycle including `not_reproduced`, `false_positive`, `accepted_risk`

**Exit:** the black-box IDOR and the white-box finding merge into one correlated finding with a verified source location. **This is the thesis proven.**

### M6 — Release assurance (weeks 16–18)

- Policy engine, evidence-class gating, replay verification
- Gate outcomes including PARTIAL; fail-closed rules
- Waivers with mandatory expiry, separate approver, expiry warnings
- Suppression store
- Report generation from the skills' report structure
- GitHub App, PR comment, check run, Actions
- CLI `gate evaluate` with explainable output

**Exit:** the vertical slice blocks a PR and explains itself.

### M7 — Surface (weeks 19–22)

- Dashboard: projects, audit detail with SSE, findings, finding detail, gate, waivers, inventory
- Jira integration with fingerprint-keyed dedup
- `nuclei`, `gitleaks`, `deps`, `axe`, `lighthouse`, `k6` adapters — `k6` last, and only once the orchestrator-side caps in [ADR-014](../20-adr/README.md#adr-014--k6-in-v1-behind-explicit-authorization) are enforced and tested
- Regression mode
- Observability: metrics, traces, alerts, product-health dashboard

**Exit:** a real project can be onboarded and run without operator assistance.

## 4. Priorities

### P0 — required to prove the thesis

Audit orchestration · build provenance · evidence store · finding schema and normalization · severity engine · fingerprinting and dedup · agent runtime with typed capabilities · correlation layers 1–3 · policy engine and gate · CLI · GitHub Actions · scope validation and sandboxing · secrets management

### P1 — required for a usable product

Dashboard · Jira · finding lifecycle and history · recon breadth (nuclei, gitleaks, deps, axe) · regression mode · report generation · waivers and suppressions · observability

### P2 — immediately post-v1

Request-ID instrumented correlation mode · Express and Django route parsing · `gau` · additional CI systems · visual regression · intelligent test selection · BrowserStack

## 5. Cut list, with reasons

| Cut | Reason |
|---|---|
| **`ffuf`** | Highest request volume, WAF-tripping, ToS-risky, noisiest output. Needs a hard authorization gate and soft-404 calibration to be safe — more machinery than its v1 value ([06 §3](../06-recon/README.md#cut-from-v1--ffuf)) |
| **`gau`** | Third-party egress and out-of-scope URL risk. Wait until the scope validator has production mileage |
| **Express route parsing** | Hardest framework, and the runtime dump solves it better. Do NestJS and FastAPI first |
| **Multi-tenant governance** | Isolation primitives built in; the governance surface is not |
| **Self-healing, visual regression, device farms** | Test-execution features. They do not test the correlation thesis |

## 6. Open items to close before or during M1

| Item | Owner | Blocks |
|---|---|---|
| **Semgrep ruleset licensing review** | Legal | M2 — swapping SAST engines later is expensive ([02 §3](../02-stack/README.md#3-open-item-semgrep-licensing)) |
| ~~Secrets management implementation choice~~ | Eng | Closed — portable provider interface; local KEK for development, cloud KMS binding deferred |
| ~~Naming: directory `Kase` vs. product name in PRD~~ — **closed.** Product is Kase throughout; CLI namespace is `kase` | Product | — |
| LLM provider contract and rate limits | Eng | M4 |
| Evidence retention policy vs. customer requirements | Product | M2 |

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Correlation accuracy below 95% | Medium | **Fatal** — the differentiator dies | Deterministic-first layering; runtime route dump; measure accuracy from M5 |
| False positives erode gate trust | High | High | Evidence-class gating; suppression store; observe-only rollout phase |
| Gate flapping | Medium | High | Fingerprint keying; `not_reproduced` stays blocking; measure flap rate |
| Cost per audit exceeds value | Medium | High | Context strategy; prompt caching; cost budgets from day one |
| An audit degrades a customer system | Low | **Severe** | Rate and request budgets; non-destructive default; paging alerts |
| Worker images become the bottleneck | High | Medium | Budget for it explicitly in M1; pin everything |
| Skill fork drifts from upstream | Medium | Low | Vendor `references/` verbatim; track `agent_prompt_version` |

## 8. How to know it worked

At the end of v1, on a real customer project:

- A PR is blocked by a critical finding the team agrees is real.
- The finding names the file and symbol, and the suggested patch applies.
- The team fixes it, re-runs, and the gate goes green.
- Nobody disabled the gate.

The last line is the actual success criterion.

---

**Next:** [20 — Decision Records](../20-adr/README.md)
