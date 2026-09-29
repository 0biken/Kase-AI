# Gates: M5 correlation

Scope: implement the M5 correlation milestone while preserving M4's open live verification and deferred G6. The first implementation slice is the deterministic correlation core and bounded NestJS source graph. Full milestone completion requires every gate below.

- [ ] G1: deterministic correlation preserves both evidence sets and rejects wrong methods, unrelated categories, unreachable or ambiguous source matches
  CHECK: node scripts/verify-m5-core.mjs
  EXPECT: KASE_M5_CORE_VERIFIED
  EVIDENCE: pending
- [ ] G2: code-map traversal resolves file-qualified symbols with bounded depth, cycles, and node counts
  CHECK: node scripts/verify-m5-core.mjs
  EXPECT: KASE_M5_CORE_VERIFIED
  EVIDENCE: pending
- [ ] G3: NestJS and FastAPI runtime adapters and OpenAPI ingestion supply ranked, commit-bound route artifacts
  EVIDENCE: pending; full adapter packaging and runtime proof required
- [ ] G4: durable correlation merges findings through real workers and retains advisory results when build provenance is absent
  EVIDENCE: pending; persistence and live integration required
- [ ] G5: exact, structural and advisory dedup produce MATCH, POSSIBLE_MATCH and NEW_FINDING with human decisions for ambiguous pairs
  EVIDENCE: pending
- [ ] G6: finding lifecycle and fingerprint suppression enforce authorized, auditable transitions
  EVIDENCE: pending
- [ ] G7: M5 changes pass API regressions and TypeScript compilation
  CHECK: node scripts/verify-m5-regressions.mjs
  EXPECT: KASE_M5_REGRESSIONS_VERIFIED
  EVIDENCE: pending
