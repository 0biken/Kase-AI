# Gates: M5 correlation

Scope: implement the M5 correlation milestone while preserving M4's open live verification and deferred G6. The first implementation slice is the deterministic correlation core and bounded NestJS source graph. Full milestone completion requires every gate below.

## Continuation — 18 November 2026

Completed this slice: reproduced the actual seeded fixture through explicit Nest class injection, retained rejection of custom/mismatched tokens, and prevented ambiguous categories, truncated source evidence, and path rewrites from creating false source attribution. The fixture test also rejects correlation after switching its controller to the ownership-scoped service method. The current workspace also contains M6 and security-import work from other development sessions, which is preserved.

Baseline environment finding: local HTTP and junction tests fail inside the Windows sandbox. The provider HTTP suite passed all 14 tests outside it. Full API acceptance also passed outside the sandbox; no paid provider calls were involved.

- [x] G1: deterministic correlation preserves both evidence sets and rejects wrong methods, unrelated categories, unreachable or ambiguous source matches
  CHECK: node scripts/verify-m5-core.mjs
  EXPECT: KASE_M5_CORE_VERIFIED
  EVIDENCE: 2026-11-18; exit 0, 2 suites / 39 tests passed; KASE_M5_CORE_VERIFIED. Includes the real seeded IDOR source fixture and ownership-fixed negative control.
- [x] G2: code-map traversal resolves file-qualified symbols with bounded depth, cycles, and node counts
  CHECK: node scripts/verify-m5-core.mjs
  EXPECT: KASE_M5_CORE_VERIFIED
  EVIDENCE: 2026-11-18; same core run, exit 0 and KASE_M5_CORE_VERIFIED. Includes explicit and aliased Nest class tokens, rejected custom/mismatched tokens, bounded traversal, and production code-map coverage.
- [x] G3: NestJS and FastAPI runtime adapters and OpenAPI ingestion supply ranked, commit-bound route artifacts
  CHECK: node scripts/verify-m5-routes.mjs
  EXPECT: KASE_M5_ROUTES_VERIFIED
  EVIDENCE: 2026-11-26; exit 0, 2 suites / 53 tests passed; KASE_M5_ROUTES_VERIFIED. Boots the real NestJS fixture with its own @nestjs/core and runs `workers/routemap/fastapi_dump.py` against the real FastAPI spike fixture. Both dumps bind to checked-out source (`InvoiceController.findOne`, `fixture/app.py` `find_one`). Artifacts from another commit, malformed envelopes, unknown fields, paths outside the checkout, unlocated, ambiguous or file-mismatched symbols, and endpoints claimed by two handlers are rejected. OpenAPI binds only through same-checkout static routes, and runtime_dump > openapi > static_parse holds against a conflicting decoy. Packaging the runners into a worker image and scheduling them as audit jobs is part of G4.
- [ ] G4: durable correlation merges findings through real workers and retains advisory results when build provenance is absent
  EVIDENCE: pending; persistence and live integration required
- [x] G5: exact, structural and advisory dedup produce MATCH, POSSIBLE_MATCH and NEW_FINDING with human decisions for ambiguous pairs
  CHECK: node scripts/verify-m5-dedup.mjs
  EXPECT: KASE_M5_DEDUP_VERIFIED
  EVIDENCE: 2026-11-26; exit 0, 2 suites / 51 tests passed, zero skipped; KASE_M5_DEDUP_VERIFIED. Level 1 fingerprint MATCH. Level 2 MATCH only for a single fully agreeing candidate without source location; cwe absent on one side, or several candidates, goes to POSSIBLE_MATCH. Level 3 advisor output is schema-checked, banded and never numeric, and yields POSSIBLE_MATCH at most. Garbage or failing advisors leave NEW_FINDING. Proposals are idempotent pending `FindingRelation` rows that never auto-resolve. Rejected pairs are never re-proposed. Confirming merges identities without evidence or source-location loss, even within one audit, and later occurrences of a merged-away fingerprint follow the merge. Wired into agent `create_finding`. Migration `20261126000000_m5_dedup_lifecycle` validates with `prisma validate` but has not been applied to a live database (no Docker).
- [x] G6: finding lifecycle and fingerprint suppression enforce authorized, auditable transitions
  CHECK: node scripts/verify-m5-lifecycle.mjs
  EXPECT: KASE_M5_LIFECYCLE_VERIFIED
  EVIDENCE: 2026-11-26; exit 0, 3 suites / 56 tests passed, zero skipped; KASE_M5_LIFECYCLE_VERIFIED. Decisions follow an explicit table with roles and a mandatory reason: false_positive and accepted_risk need approver or admin, reopen needs admin, and confirm_fixed is the only way into `fixed`. Refusals change nothing and are not recorded as transitions. Each transition writes `finding.status.transition` to the audit trail. false_positive creates exactly one fingerprint suppression and reopen removes it. Audit settlement applies observation inside the scheduler transaction and appends `finding.lifecycle`: reappearance gives regressed or open; absence gives not_reproduced, and only for a completed audit that ran the producing category; fixed ages into verified; imports and human decisions are never observed. The gate treats accepted_risk and false_positive as warnings, while not_reproduced keeps blocking.
- [x] G7: M5 changes pass API regressions and TypeScript compilation
  CHECK: node scripts/verify-m5-regressions.mjs
  EXPECT: KASE_M5_REGRESSIONS_VERIFIED
  EVIDENCE: 2026-11-26; exit 0, all 68 API suites / 571 tests passed, followed by successful tsc --noEmit; KASE_M5_REGRESSIONS_VERIFIED.

Next: G4, which needs Docker. It covers the route-map runners in a worker image, a `correlate` job in the graph, the dedup/lifecycle migration applied to PostgreSQL, and the live compose proof of both exit criteria. Layer-4 advisory AI correlation is the last unbuilt M5 checklist item. M5 remains incomplete until G4 passes.
