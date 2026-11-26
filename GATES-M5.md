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
- [ ] G3: NestJS and FastAPI runtime adapters and OpenAPI ingestion supply ranked, commit-bound route artifacts
  EVIDENCE: pending; full adapter packaging and runtime proof required
- [ ] G4: durable correlation merges findings through real workers and retains advisory results when build provenance is absent
  EVIDENCE: pending; persistence and live integration required
- [ ] G5: exact, structural and advisory dedup produce MATCH, POSSIBLE_MATCH and NEW_FINDING with human decisions for ambiguous pairs
  EVIDENCE: pending
- [ ] G6: finding lifecycle and fingerprint suppression enforce authorized, auditable transitions
  EVIDENCE: pending
- [x] G7: M5 changes pass API regressions and TypeScript compilation
  CHECK: node scripts/verify-m5-regressions.mjs
  EXPECT: KASE_M5_REGRESSIONS_VERIFIED
  EVIDENCE: 2026-11-18; exit 0, all 66 API suites / 528 tests passed, followed by successful tsc --noEmit; KASE_M5_REGRESSIONS_VERIFIED.

Next: G3 runtime adapter packaging and commit-bound route artifact validation. M5 remains incomplete until G3–G6 have implementation and verification evidence.
