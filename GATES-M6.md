# Gates: M6 release assurance

Scope: the vertical slice blocks a PR and explains itself ([19 §3 M6](docs/19-roadmap/README.md), [12 — Policy gate](docs/12-policy-gate/README.md)). The gate engine, policy CRUD, evaluation service and waivers are implemented (`47e8f74`, `fab9e90`, `9fe2706`, `cfb4825`, `cc6a6e4`). Live replay, report generation, the GitHub App and the PR exit proof are still to come. Full milestone completion needs every gate below. Local green tests never close G5–G8.

## Ledger opened — 26 November 2026

Docker's Linux engine is unavailable on this machine, so G5 and G8 have no live evidence. M6 also depends on M5 G4, which is the correlated finding coming through real workers, before G8 can run.

- [x] G0: this ledger states executable outcomes that can fail
  CHECK: node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M6.md
  EXPECT: LINT OK
  EVIDENCE: 2026-11-26; exit 0; LINT OK with four expected manual-gate warnings for the live gates G5–G8

- [x] G1: the policy DSL and pure gate engine produce PASS/FAIL/PARTIAL deterministically, PARTIAL never becomes PASS, and degraded or not-executed categories fail closed
  CHECK: node scripts/verify-m6-gate-engine.mjs
  EXPECT: KASE_M6_GATE_ENGINE_VERIFIED
  EVIDENCE: 2026-11-26; exit 0; 34 tests passed; KASE_M6_GATE_ENGINE_VERIFIED

- [x] G2: gate policies are versioned per project, and every evaluation records the policy version it used
  CHECK: node scripts/verify-m6-policy-crud.mjs
  EXPECT: KASE_M6_POLICY_CRUD_VERIFIED
  EVIDENCE: 2026-11-26; exit 0; 8 tests passed; KASE_M6_POLICY_CRUD_VERIFIED

- [x] G3: only replayable evidence can block, and AI-only or unreplayable matches are downgraded to warnings
  CHECK: node scripts/verify-m6-gate-evaluation.mjs
  EXPECT: KASE_M6_GATE_EVALUATION_VERIFIED
  EVIDENCE: 2026-11-26; exit 0; 12 tests passed; KASE_M6_GATE_EVALUATION_VERIFIED

- [x] G4: waivers are fingerprint-scoped, expire within the policy maximum and reject approver equal to requester when required; suppressions are fingerprint-keyed
  CHECK: node scripts/verify-m6-waivers.mjs
  EXPECT: KASE_M6_WAIVERS_VERIFIED
  EVIDENCE: 2026-11-26; exit 0; 7 tests passed; KASE_M6_WAIVERS_VERIFIED

- [ ] G5: live replay re-issues the stored exchange from a sandboxed recon-egress worker: vulnerable → `reproduced`, fixed → `not_reproduced`, unreachable → `error` with the block standing
  EVIDENCE: pending; the `ReplayVerifier` default fails closed (`error`), and there's no live adapter yet

- [x] G6: the audit report follows the skills' report structure, builds the executive summary last, and surfaces waivers expiring within `warn_before_expiry_days`
  CHECK: node scripts/verify-m6-report.mjs
  EXPECT: KASE_M6_REPORT_VERIFIED
  EVIDENCE: 2026-11-26; exit 0; 18 API tests (golden executive summary, summary-last index, must-fix ranking, expiry warning, escaping, service and route) and 18 CLI tests passed; KASE_M6_REPORT_VERIFIED

- [ ] G7: the GitHub App creates a check run (PARTIAL is never `success`) and one upserted PR comment citing rule, evidence and source location; the published Action exits on the gate outcome
  EVIDENCE: pending; not implemented

- [ ] G8: a fixture PR carrying the IDOR is blocked with an actionable explanation, and pushing the one-token ownership fix flips the same PR to green
  EVIDENCE: pending; needs G5, G7 and M5 G4

Next: G5 live replay adapter (Track B), plus G7 GitHub App (Track A), as set out in [PLAN-M4-M7.md](PLAN-M4-M7.md) Phase 4.
