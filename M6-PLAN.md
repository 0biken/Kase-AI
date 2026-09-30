# M6 — Release Assurance: implementation plan

**Milestone goal (from [TASKS.md](TASKS.md) / [19 — Roadmap](docs/19-roadmap/README.md)):** the vertical slice blocks a PR and explains itself, and fixing the fixture flips the same PR to green.

**Design source of truth:** [12 — Policy Engine & Release Gate](docs/12-policy-gate/README.md). This plan does not restate that design; it sequences the build against it and against the code and schema that already exist.

> **Status when written (2026-09-30):** not started. `apps/api/src/assurance/assurance.module.ts` is an empty placeholder. This plan assumes M5 correlation is *certified* (durable merge through real workers), because the gate consumes correlated findings and their evidence classes — see **§0 Preconditions**.

---

## 0. Preconditions and what is already done

The single most important fact about M6: **the data model is already in place.** These models were forward-declared in earlier milestones and are live in [`packages/db/schema.prisma`](packages/db/schema.prisma):

| Model | Role in M6 | State |
|---|---|---|
| `GatePolicy` | versioned, project-scoped, `rules` JSON, `@@unique([projectId, version])` | schema ✅, no service |
| `GateEvaluation` | persisted outcome: `outcome`, `blockingFindingIds[]`, `waivedFindingIds[]`, `notExecutedCategories[]`, `commitSha` | schema ✅, no service |
| `Waiver` | `fingerprint`, `reason`, `requestedBy`, `approvedBy`, `expiresAt`, `affectedRelease` | schema ✅, no service |
| `Suppression` | `fingerprint`, `markedBy`, `reason` | schema ✅, no service |
| `FindingIdentity` | `status`, `currentSeverity`, `fingerprint`, `waiverId` — the durable identity the gate keys on | live from M2/M5 |
| `Finding.gateEligible`, `FindingEvidence.role`, `Evidence.replayable` | evidence-class inputs, **set at capture** | live |
| `Correlation.method` + `.verified` | correlation-verification input | live from M5 |

**Consequence:** M6 is a **services + controllers + CLI + integrations** milestone. There is little-to-no new schema. If a migration is needed at all, it is additive (e.g. a `GatePolicy.mode` column for rollout phases — see §1).

**Hard dependencies before starting:**
- **M5 certified** (durable correlation through real workers, `Correlation` rows persisted with `method`/`verified`). The gate reads correlation verification; building it on the un-certified M5 means the gate's most defensible path is unproven.
- **A Linux Docker engine** for the acceptance gates (§9). The gate's replay-verification and the PR-block acceptance run live, exactly like M2/M3 Compose proofs. This is the same environmental blocker M4/M5 hit — resolve it once, it unblocks the whole tail.

**Explicitly out of scope for M6** (they live in M7): the dashboard surface, Jira, and extra adapters. M6 ships the gate, waivers, report, GitHub App/Action, and the CLI `gate` command.

---

## 1. Module layout

Flesh out the placeholder `AssuranceModule` into the M6 subsystem. Keep the gate engine a **pure, dependency-free function** so it is unit-testable without Nest, Prisma, or a network — this is what makes §2's determinism claim real.

```
apps/api/src/assurance/
  assurance.module.ts            # wires the below into AppModule
  policy/
    gate-policy.service.ts       # CRUD + versioning over GatePolicy
    gate-policy.controller.ts    # /projects/:id/gate-policies
    policy-schema.ts             # zod schema for the rules DSL (§4 of the doc)
    default-policy.ts            # the seeded `version:1 name:default` policy
  gate/
    gate-engine.ts               # PURE: (findings, evidence, policy, context) -> decision. No I/O.
    gate-evaluation.service.ts   # loads inputs, calls engine, runs replay, persists GateEvaluation
    gate.controller.ts           # POST /audits/:id/gate:evaluate, GET /audits/:id/gate
    replay-verifier.service.ts   # re-issues stored http_replay exchanges (fail-closed)
  waivers/
    waiver.service.ts            # create/approve/list, expiry math
    waiver.controller.ts         # /projects/:id/waivers
    suppression.service.ts       # fingerprint-keyed, fed by false_positive
  report/
    report-builder.service.ts    # follows the skills' report-structure; exec summary built last
  integrations/                  # GitHub only in M6; Jira is M7
    github-app.module.ts
    github-check-run.service.ts
    github-pr-comment.service.ts
```

CLI (`apps/cli/src`): add a `gate` command group alongside the existing `audit` and `findings` groups.

New GitHub Action package: `packages/action/` (or `apps/action/`) — the published composite/JS action that calls the API and maps the outcome to a CI exit code.

---

## 2. Workstream A — Gate policy store and versioning

Maps to TASKS.md M6: *"Policy engine with per-project configurable policies"*.

1. **`policy-schema.ts`** — a zod schema for the rules DSL in [doc §4](docs/12-policy-gate/README.md#4-gate-policy): `block_on[]`, `warn_on[]`, `required_categories[]`, `fail_closed{}`, `waivers{}`. Reject unknown keys (fail-closed on malformed policy — doc §7). This schema is the contract the engine and the CLI both validate against.
2. **`gate-policy.service.ts`** — create/read/list. **Policies are immutable per version**: an "edit" writes a new `version` (the `@@unique([projectId, version])` already enforces this). Every `GateEvaluation` stores `gatePolicyId` + `gatePolicyVersion` so a historical decision stays reproducible (doc §4).
3. **`default-policy.ts`** — seed the doc §4 default on project creation (deterministic scanner criticals block; agent findings block only with replayable evidence; `required_categories` present).
4. **Rollout mode** (doc §10) — Observe / Block-criticals / Full. Cleanest as an additive `GatePolicy.mode` enum column (`observe | block_critical | full`) rather than smuggling it into `rules`. This is the **only candidate migration** in M6; keep it additive with a default of `observe` so a new project cannot start in a blocking mode by accident.
5. **API**: `POST/GET /projects/:id/gate-policies`, `GET /projects/:id/gate-policies/:version`. Reuse the existing `ProjectScopeGuard`, RFC 9457 errors, ULIDs, cursor pagination — same conventions as the Project/Target CRUD from M1.

---

## 3. Workstream B — Gate evaluation engine (the core)

Maps to TASKS.md M6: *evidence-class gating, replay verification, PASS/FAIL/PARTIAL, fail-closed, gate result record*.

### B1. The pure engine — `gate-engine.ts`
Signature (no I/O, fully unit-testable):
```
evaluateGate(input: {
  audit: { status, degraded, executedCategories };
  findings: NormalizedGateFinding[];   // identity, fingerprint, severity, origin,
                                        // category, gateEligible, evidence[], correlation
  policy: ParsedPolicy;
  waivers: ActiveWaiver[];             // fingerprint-keyed, non-expired
  suppressions: Suppression[];
}): GateDecision                        // outcome + blocking[] + warnings[] + waived[] + notExecutedCategories[]
```
Rules, in the doc's pipeline order (doc §1): schema-valid → **evidence-class** (a finding may block only if it carries ≥1 replayable-class artifact — `FindingEvidence` whose `Evidence.replayable` is true; doc §3) → correlation verification (`Correlation.verified`) → suppression/waiver → policy `block_on`/`warn_on`. The engine emits, per blocking finding, the **exact rule that fired** and the **evidence that supports it** (doc §8) — this is the explainability the acceptance criterion demands.

**Invariants enforced here, with a unit test per invariant** (these are the standing invariants in TASKS.md):
- `PARTIAL` is never `PASS` — audit `partial`/`degraded` ⇒ outcome ∈ {PARTIAL, FAIL}, never PASS (doc §6).
- No AI-emitted number is compared to a threshold — the engine gates on `evidence.replayable` (a capture-time boolean) and `correlation.method`/`verified`, never on `confidenceBand` as a number.
- AI-only findings (`origin` agent, no replayable evidence) ⇒ WARN, never BLOCK.
- `required_categories_not_executed` ⇒ FAIL (coverage gate).
- `finding_status = regressed` and `not_reproduced` handling per doc §9 (a vanished finding does not open the gate).

### B2. Replay verification — `replay-verifier.service.ts`
Before any block on an `http_replay` finding, re-issue the stored exchange against the current build (doc §3):

| Replay result | Effect |
|---|---|
| Reproduces | BLOCK confirmed |
| Does not reproduce | finding → `fixed`, not blocking |
| **Replay errored** (target down/timeout) | **BLOCK stands — fail closed** |

Replay runs in the sandboxed worker path (recon-family egress rules), not in the API process. The re-issued request is what the engineer can run themselves — capture it into the `GateEvaluation` output.

### B3. Orchestration + persistence — `gate-evaluation.service.ts`
Loads findings/evidence/correlations/waivers/suppressions for the audit, normalizes to the engine's input shape, calls B2 for replay-class blockers, calls B1, and **persists one `GateEvaluation` row** (`outcome`, `blockingFindingIds`, `waivedFindingIds`, `notExecutedCategories`, `commitSha`, `gatePolicyId/Version`). Fail-closed table (doc §7): policy fails to load ⇒ FAIL; orchestrator crash / audit incomplete ⇒ FAIL; evidence integrity check failed ⇒ finding non-eligible, and if it was the only blocker ⇒ PARTIAL.

**API:** `POST /audits/:id/gate:evaluate`, `GET /audits/:id/gate` (returns the persisted, explainable JSON from doc §8).

---

## 4. Workstream C — Waivers and suppressions

Maps to TASKS.md M6: *fingerprint-scoped, mandatory expiry, requester ≠ approver, expiry warnings*.

- **`waiver.service.ts`** — waivers are **scoped to `fingerprint`, never `Finding.id`** (the model already enforces this; a finding ID is per-audit and would evaporate — doc §5). `expiresAt` is **mandatory**; there is no permanent waiver (permanent acceptance is the `accepted_risk` finding status, a different record). `reason` required and stored. Enforce `require_separate_approver` from policy: reject `requestedBy == approvedBy` when set. On approval, link `FindingIdentity.waiverId`.
- **Expiry warnings** surfaced in **three places** (doc §5): the report (§5 workstream D), the CI output / PR comment (§6 workstream E), and — later — the dashboard (M7). Default warn window 7 days; compute `daysRemaining` in the gate output's `waived[]`.
- **`suppression.service.ts`** — fingerprint-keyed, fed by the `false_positive` finding status. Durable, so a confirmed false positive does not return and re-flap the gate (doc §9).
- **API:** `POST/GET /projects/:id/waivers`, `POST /projects/:id/waivers/:id:approve`, `POST /projects/:id/suppressions`.

---

## 5. Workstream D — Report generation

Maps to TASKS.md M6: *report following the skills' report structure, executive summary built last*.

- **`report-builder.service.ts`** consumes the vendored methodology `report-structure*.md` (already in `methodology/`, vendored in M4). Compose the body first (findings by severity/category, correlation chains, evidence, waiver section with expiry warnings), then build the **executive summary last** from the assembled body.
- Output both machine (JSON, the doc §8 shape) and human (Markdown) forms; the GitHub check-run summary (§6) is a projection of this.

---

## 6. Workstream E — GitHub App, check run, and published Action

Maps to TASKS.md M6: *GitHub App PR comment + check run; GitHub Actions workflow and published action*.

- **`github-app.module.ts`** — GitHub App auth (installation token), webhook receiver for `pull_request`. **App install / OAuth consent is a user action**, not something this build performs silently — the plan wires the code; a human authorizes the App on the target org.
- **`github-check-run.service.ts`** — create/update a check run on the PR head SHA. Map `GateDecision.outcome` → check conclusion: PASS→success, FAIL→failure, PARTIAL→neutral-or-failure per project policy. Summary cites, per block, the policy rule and the replayable evidence (the "explains itself" acceptance criterion).
- **`github-pr-comment.service.ts`** — one sticky comment, updated in place (no comment spam across re-runs); includes the waiver/expiry section.
- **`packages/action/`** — the published Action: reads `KASE_API_TOKEN` + project, triggers/*awaits* the audit's gate evaluation, and exits `0/1/2` for PASS/FAIL/PARTIAL (doc §6). Ship an example `kase-gate.yml` workflow.
- **Provenance tie-in:** the Action passes the CI commit SHA so build provenance is `ci_supplied`; a mismatch with the target-reported SHA already refuses to verify (M2), which downgrades correlated blockers to advisory rather than producing a false block.

---

## 7. Workstream F — CLI `kase gate evaluate`

Maps to TASKS.md M6: *`kase gate evaluate` with explainable output — cites rule, evidence, source location*.

Add a `gate` group to `apps/cli/src/main.ts`:
- `kase gate evaluate --audit <id>` → calls `POST /audits/:id/gate:evaluate`, prints the explainable decision, exits `0/1/2`.
- `kase gate show --audit <id>` → prints the last persisted `GateEvaluation`.
- Human and `--json` output; the human form prints, per block: rule fired → evidence (with the replay command) → source location (`file:enclosingSymbol`, `verified`). Reuse the existing CLI client/error conventions.

---

## 8. Build order (dependency-ordered)

1. **A (policy store + schema + default seed)** — everything else needs a parseable policy.
2. **B1 (pure engine) + its invariant unit tests** — the deterministic core; no I/O, so it lands and proves fast. This is the milestone's risk-carrying heart; do it early.
3. **B3 persistence + B2 replay** — needs workers/evidence, so needs Docker.
4. **C (waivers/suppressions)** — feeds `waived[]` into the engine inputs.
5. **F (CLI)** — thin layer over B3; enables local acceptance dry-runs.
6. **D (report)** — consumes a completed evaluation.
7. **E (GitHub App/Action)** — the outermost layer; the PR-block acceptance runs here.

Steps 1–2 and the unit-level parts of 4–5 are **doable now without Docker** (mirroring how M4/M5 landed their local proofs first). Steps 3, and the acceptance in §9, need the Linux Docker engine.

---

## 9. Exit criteria and gate proofs (`GATES-M6.md`)

Follow the M2–M5 pattern: local deterministic proofs certify subsets; live Compose proofs certify acceptance. Create `GATES-M6.md` with executable `CHECK`/`EXPECT` lines and a `scripts/verify-m6-*.mjs` + `scripts/m6-compose-proof.ps1`.

**Local (no Docker):**
- `verify-m6-gate-engine.mjs` → pure-engine invariants: PARTIAL≠PASS, evidence-class blocks only on replayable class, AI-only ⇒ WARN, required-category-missing ⇒ FAIL, malformed policy ⇒ FAIL, waiver expiry math, requester≠approver.
- `verify-m6-policy-schema.mjs` → policy DSL validation (accept default, reject unknown keys / missing required_categories).
- `verify-m6-regressions.mjs` → full API suite + `tsc` (extends the existing 415-test suite).

**Live (Docker) — the milestone acceptance:**
- `m6-compose-proof.ps1`:
  1. Audit the vulnerable fixture (`fixtures/vulnerable-app/`), produce the correlated IDOR finding (M5 path).
  2. Evaluate the gate → **FAIL**, blocking the correlated finding, with replay reproduced and the explanation citing rule + evidence + `InvoiceService.find`.
  3. Open a PR against the fixture → the published Action / check run **blocks it and explains why**. *(Exit criterion 1.)*
  4. Apply the fixture's ownership-predicate fix, re-run → replay does **not** reproduce → finding `fixed` → gate **PASS** → **the same PR flips green**. *(Exit criterion 2.)*
  5. Fail-closed controls: replay-error-while-target-down ⇒ BLOCK stands; audit forced `partial` ⇒ PARTIAL (never PASS); waiver on the IDOR fingerprint ⇒ release allowed, waiver + `daysRemaining` reported; expired waiver ⇒ blocks again.

Do **not** mark any exit criterion `[x]` in TASKS.md until its live proof produces the success marker — same discipline as M4/M5. Locally-proven engine work is `[~]` until the Compose acceptance passes.

---

## 10. Standing invariants this milestone must not break

(from TASKS.md "Standing invariants" — check they still hold at M6, not just once)
- No AI-emitted number is ever compared against a threshold — the gate keys on evidence class and correlation method/verified, never on `confidenceBand`.
- No degraded or partial audit can produce `PASS`.
- Only replayable-class artifacts can block; AI-only findings warn.
- Replay error fails closed; policy-load failure fails closed.
- Waivers are fingerprint-scoped and mandatorily expiring; suppressions are durable and fed only by `false_positive`.
- Every block cites the rule that produced it and the evidence that supports it.

---

## 11. Risks and estimate notes

- **Biggest risk is not the engine — it's the live loop.** The pure gate engine is small and deterministic; the schema exists. The cost and risk concentrate in the GitHub App auth + check-run round-trip and the Docker-based PR-block acceptance. Budget accordingly; land the engine + invariants first so the risky integration work sits on a proven core.
- **Docker/host dependency** is shared with the still-open M4/M5 acceptance. One Linux Docker engine unblocks M4 G5, M5 G4, and M6 §9 together — sequence that environment fix ahead of the integration work.
- **Rollout mode default matters.** Ship `observe` as the default so a freshly onboarded project cannot produce a surprise red build before its false-positive profile is known (doc §10). This is a one-line default with outsized credibility impact.
