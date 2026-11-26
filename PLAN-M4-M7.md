# Kase — Implementation Plan to v1 (M4 → M7)

Written 2026-11-26 from the state recorded in [TASKS.md](TASKS.md), [GATES-M4.md](GATES-M4.md), [GATES-M5.md](GATES-M5.md) and the code on `feat/m6-gate-controller-cli`.

## Where we are

| | Built (code + local tests) | Proven (live exit criteria) |
|---|---|---|
| M1–M3 | 100% | 100% |
| M4 Agent runtime | ~70% | 0% — G1–G6 pending |
| M5 Correlation | ~45% | 0% — G3–G6 pending |
| M6 Release assurance | ~40% | 0% — no ledger yet |
| M7 Surface | ~5–10% | 0% |
| **Overall (week-weighted)** | **~60%** | **~36%** |

**The critical blocker isn't code, it's the environment.** No Docker Linux engine and no provider keys means every live proof for M4 and M5 is stalled. Most of the gap between built and proven closes once that's fixed.

**Second risk: a large uncommitted working tree** (around 50 modified files across API, CLI, web, scripts and docs). It should be committed before anything else.

## Sequencing principle

Work runs on two tracks in parallel:

- **Track A — no Docker needed.** Pure-logic and API work that can be finished and unit-tested now: dedup, lifecycle, route adapters, reports, the GitHub App and the dashboard.
- **Track B — needs Docker and keys.** Live proofs: the M4 G2/G3/G5/G6 gates, M5 G4, the M6 replay adapter and the M6 exit.

Track A never waits on Track B. Track B starts as soon as the environment is unblocked, and is always run as one bounded attempt per gate, as GATES-M4 requires.

---

## Phase 1 — Stabilise the branch (≈2 days)

| # | Task | Files | Done when |
|---|---|---|---|
| 1.1 | Review and commit the dirty working tree in logical commits (M4 repair, M5 core, M6 gate/CLI, web) | everything in `git status` | `git status` clean; `pnpm -r test` and `tsc --noEmit` green |
| 1.2 | Open PR `feat/m6-gate-controller-cli` → `main` | — | PR open, CI green |
| 1.3 | Create `GATES-M6.md` ledger in the same format as M4/M5 (G0 lint, G1 engine/policy, G2 waivers/suppression, G3 replay, G4 report, G5 GitHub, G6 exit), and add `scripts/verify-m6-gate.mjs` emitting `KASE_M6_GATE_VERIFIED` for the existing gate/policy/waiver specs | `GATES-M6.md`, `scripts/` | `node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M6.md` → `LINT OK`; local G1/G2 checked |
| 1.4 | Update the roadmap README status lines for M4–M6 so they say "implemented, unproven" | `docs/19-roadmap/README.md` | matches TASKS.md |

## Phase 2 — Unblock live proofs (Track B, user action + ≈1 week)

**User-only prerequisites:**
1. Install or repair Docker Desktop with the WSL2 Linux engine; confirm that `docker info` shows `OSType: linux`.
2. Configure provider keys for **Gemini (`gemini-4-carbon`) plus one of Anthropic or OpenAI** (`KASE_M4_SECOND_PROVIDER`), with pinned model IDs (`KASE_M4_<P>_MODEL_ID`), `KASE_<P>_BASE_URL` and `KASE_AGENT_ROUTER_HOSTS`. This is the G6 rescope from 2026-11-13.

**Then, in order:**

| # | Gate | Command | Done when |
|---|---|---|---|
| 2.1 | M1–M3 regression on rebuilt images | existing M1–M3 compose proofs | all pass. This confirms that nothing regressed since M3 closed |
| 2.2 | M4 G2 database subset | `node scripts/m4-database-proof.mjs` | clean and M3-upgrade migrations, concurrent reservations, duplicate settlement and recovery all pass |
| 2.3 | M4 G5 live Compose, deterministic provider | `scripts/m4-compose-proof.ps1 -KeepStack` | prints `M4 agent proof passed:`; the 3 scenarios (happy path, crash recovery, cancellation) pass |
| 2.4 | M4 G3/G4 live containment and persistence | fold into the G5 stack: agent cannot reach the fixture or proxy directly; findings, evidence and transcripts persist durably | ledger evidence recorded |
| 2.5 | M4 G1 golden contract, part A live | `pnpm --filter @kase/api test:live` | two-turn tool exchange per provider; every event schema-validated |
| 2.6 | **M4 G6 real-provider exit** | `scripts/m4-real-provider-proof.ps1` | unaided IDOR discovery with replayable evidence plus independent replay; **zero** findings against the ownership-fixed fixture → **M4 closed** |

If 2.6 fails, don't retry until it passes. Record the failure, fix the prompt, methodology or capability, and make one new bounded attempt.

## Phase 3 — Finish M5 Correlation (Track A, ≈2 weeks; G4 needs Track B)

### 3.1 Route-map adapters — closes G3
- **`kase-routemap` for NestJS (runtime dump):** package the spike's route dump as an adapter under `apps/api/src/adapters/routemap/` plus a worker image stage. It boots the target app with a dump hook, emits `{method, pathTemplate, handlerSymbol, file}` and stores the result as evidence keyed by commit SHA.
- **FastAPI:** the same contract, using `app.routes` introspection via a small Python shim in the `sast` image.
- **OpenAPI ingest:** wire the existing `ingestOpenApi` into the job graph as a deterministic source. Reject a spec whose commit SHA doesn't match the audit's.
- **Ranking:** `route-resolution.ts` already ranks `runtime_dump > openapi > static_parse`. Add a test that a conflicting lower-rank route never overrides a higher-rank one.
- **Done when:** `scripts/verify-m5-routes.mjs` passes for the NestJS and FastAPI fixtures, and the route artifacts carry and enforce the commit SHA.

### 3.2 Three-level dedup — closes G5
- New `apps/api/src/correlation/dedup.service.ts`:
  1. **Exact:** same fingerprint → `MATCH`.
  2. **Structural:** same category, route template and enclosing symbol, but a different fingerprint → `POSSIBLE_MATCH`.
  3. **AI-assisted:** advisory only, and it may only *propose* `POSSIBLE_MATCH`. It can never produce `MATCH`, and its ordinal confidence is never compared to a threshold.
- Persist decisions to `FindingRelation`.
- `POSSIBLE_MATCH` goes into a human queue: `GET/POST /projects/:id/dedup-queue` with `confirm` and `reject` actions, both recorded in the audit trail. Nothing auto-resolves.
- **Done when:** unit tests cover all three outcomes, and an ambiguous pair stays unresolved until a human decides.

### 3.3 Finding lifecycle and suppression feed — closes G6
- `apps/api/src/findings/lifecycle.service.ts`: an explicit transition table (`new→open`, `open→fixed`, `fixed→verified`, `verified→regressed`, `*→not_reproduced/false_positive/accepted_risk`), with role checks and an audit-trail event per transition.
- Any transition to `false_positive` creates a fingerprint `Suppression` through the existing `suppression.service.ts`.
- Any transition to `accepted_risk` requires a linked, unexpired waiver.
- API: `POST /projects/:id/findings/:fid/transition`. CLI: `kase findings transition`.
- **Done when:** every illegal transition is rejected, every legal one is audited, and suppressed fingerprints are excluded by the gate engine.

### 3.4 Layer 4 AI correlation (advisory)
- An optional final layer in `correlation-engine.service.ts`, used only when layers 1–3 find nothing.
- Output is tagged `method: ai_inference` with `confidenceBand: 'low' | 'medium'`. The gate engine already treats AI-only findings as warn-only. Add a test proving that a layer-4 correlation can never block.

### 3.5 Durable correlation through real workers — closes G4 (Track B)
- Add a `correlate` job node to `orchestrator/job-graph.ts` that depends on the black-box agent, SAST and route-map jobs.
- Extend the compose driver with `scripts/m5-compose-proof.ps1`, which must show:
  - the fixture IDOR produces **exactly one** correlated finding at the service method, with both evidence artifacts kept;
  - with build provenance removed, the same finding appears but only as advisory.
- **Done when:** both M5 exit criteria are checked. **This proves the thesis.**

## Phase 4 — Finish M6 Release assurance (≈2–3 weeks)

### 4.1 Live replay verifier (Track B)
- Replace the fail-closed default in `assurance/gate/replay-verifier.ts` with an adapter that re-issues the stored HTTP exchange from a sandboxed recon-egress worker. It goes through the scope validator and the per-host rate limiter, and redacts registered secrets.
- Outcomes are `reproduced`, `not_reproduced` or `error`, and the engine semantics stay as they are.
- **Done when:** a vulnerable fixture gives `reproduced`, the fixed fixture gives `not_reproduced`, and an unreachable target gives `error` with the block standing.

### 4.2 Report generation (Track A)
- `apps/api/src/assurance/report/report.service.ts`. It follows the skills' report structure in `methodology/v1`: findings by severity, evidence links, correlation chain, waivers expiring within `warn_before_expiry_days`, coverage and blocked categories. The **executive summary is generated last** from the assembled sections.
- Formats: Markdown (canonical) and JSON. HTML or PDF can come later.
- API: `GET /audits/:id/report`. CLI: `kase report --audit <id> [--format md|json]`.
- **Done when:** a golden-file test passes on the fixture audit and includes the expiry warning.

### 4.3 GitHub App (Track A, then live)
- New `apps/github-app` (or a module in the API) using Octokit App auth. The webhook handles `pull_request` and `check_suite`.
- Flow:
  1. A PR opens or updates.
  2. Start an audit with `ci_supplied` provenance (head SHA).
  3. Create the check run as `in_progress`.
  4. When the audit finishes, run the gate.
  5. Complete the check run (`success`, `failure`, or `neutral` for `PARTIAL`, never `success`). Add annotations at the verified source locations and upsert one PR comment containing the `formatGate` explanation and the report summary.
- Webhook signature verification; app private key through the secrets module (envelope encryption).

### 4.4 GitHub Actions
- `.github/actions/kase-gate/action.yml`: a composite action that installs the CLI, runs `kase audit start --wait`, then `kase gate evaluate`, with the exit code following the outcome.
- `.github/workflows/kase.yml` example for the fixture repo.

### 4.5 M6 exit (Track B)
- `scripts/m6-pr-proof.ps1` against a throwaway fixture repo:
  1. A PR with the IDOR gives a failed check run that explains the block (rule, evidence, source).
  2. Pushing the one-token `findScoped` fix flips the same PR to green.
- **Done when:** both M6 exit criteria are checked, with evidence in GATES-M6.

## Phase 5 — M7 Surface (≈4 weeks)

### 5.1 Dashboard (Track A, ≈1.5 weeks)
| Item | Work |
|---|---|
| Projects list and detail | `app/dashboard/projects/` pages backed by the existing CRUD API |
| Audit detail with SSE | subscribe `audits/[auditId]` to `audit-events.controller.ts` using `EventSource` through the Next proxy; reconnect with `Last-Event-ID` |
| Findings filters | severity, category and status filters as URL search params; server-side filtering in `findings.controller.ts` |
| Finding detail | evidence viewer (HTTP exchange, redacted), correlation chain (reuse `correlation-visual.tsx`), source excerpt via `get_source`-equivalent API, lifecycle transition buttons |
| Gate status and history | `GateEvaluation` history per project or branch; flapping indicator |
| Waivers | list, create (requester ≠ approver) and expiry countdown |
| Inventory and drift | endpoint inventory table plus added, removed and changed drift between audits |

### 5.2 Tool adapters (Track A, then live, ≈1.5 weeks)
Each one follows the M2 adapter pattern: pinned image, normalizer, adapters never set severity, and an explicit evidence class (already listed in `evidence-classification.ts`).
1. `gitleaks` (sast image): secret findings, with the matched value redacted at capture.
2. `deps` (`npm audit`, `pip-audit`, OSV): fingerprint keyed on package@version plus advisory ID.
3. `nuclei` (recon image, gate-eligible): only templates from a pinned and vetted set; every target re-enters the scope validator.
4. `axe` and `lighthouse` (browser image): Lighthouse advisory by default.
5. `k6` stays last and stays out until the caps in ADR-014 are enforced and tested.

### 5.3 Jira integration (≈3 days)
- Issue create and update keyed on **fingerprint** (stored as an entity property), so there are no duplicates across audits. Severity mapping comes from config, and evidence is attached as redacted files.

### 5.4 Regression mode (≈2 days)
- Audit mode `regression`: re-test only the fingerprints marked `fixed`. A reproduced one moves to `regressed`; otherwise it moves to `verified`.

### 5.5 Observability (≈3 days)
- OpenTelemetry SDK in the API and workers, with trace context propagated through BullMQ job data.
- Metrics for audit and job duration, tool failures, finding counts, LLM spend (from the budget service) and queue depth.
- Alerts on gate flapping (the outcome changes on an unchanged SHA) and on the agent failure rate.

### 5.6 M7 exit
- **Determinism:** two audits of an unchanged commit must produce identical fingerprints and identical gate outcomes. Automate this as `scripts/m7-determinism-proof.mjs`.
- **Onboarding:** someone who didn't build Kase onboards a non-fixture project using only the docs. Record the friction points and fix them.

---

## Timeline (one engineer, Track A and Track B interleaved)

| Weeks from now | Track A (no Docker) | Track B (Docker and keys) |
|---|---|---|
| 0–0.5 | Phase 1 stabilise and commit | user unblocks Docker and keys |
| 0.5–2.5 | M5 3.1–3.4 (routes, dedup, lifecycle, layer 4) | M4 2.1–2.6 → **M4 closed** |
| 2.5–3.5 | M6 4.2 report, 4.3 GitHub App, 4.4 Action | M5 3.5 → **M5 closed (thesis proven)** |
| 3.5–5 | M7 5.1 dashboard | M6 4.1 replay, 4.5 → **M6 closed** |
| 5–8 | M7 5.2–5.5 | M7 live adapter proofs, 5.6 → **M7 closed, v1** |

**About 8 weeks to v1**, assuming Docker and keys are available within the first week. Every week the environment stays blocked moves the M4, M5 and M6 closures back by that week, even though Track A keeps going.

## Standing rules for every phase
- Each gate is one bounded attempt with recorded evidence. Local green tests never close a live gate.
- Re-check the eight standing invariants in TASKS.md at each milestone close, and record the evidence in that milestone's ledger.
- Update TASKS.md checkboxes and the counts table in the same commit that changes status.
