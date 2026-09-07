# Gates: Kase M3 recon and canonical endpoint inventory

OWNS: GATES-M3.md, TASKS.md, README.md, apps/api/**, docker-compose.yml, docs/**, fixtures/**, infra/**, package.json, packages/db/**, pnpm-lock.yaml, scripts/**, workers/**

Scope: deliver the durable, scope-safe Katana/httpx recon pipeline, canonical persisted inventories, cross-audit drift, API access, and retained-stack proof without regressing M1 or M2.

## Continuation review — 2026-09-07

The pre-review images passed the retained M3 proof (audit `aud_01M1XSADA8DZRWN4031VK8STAY`). M1 and M2 live regressions subsequently exited zero with `KASE_M1_M2_LIVE_REGRESSIONS_VERIFIED` (M1 audit `aud_01M1YDP7RFPXS6H1X9VB5RKZ8M`, M2 audit `aud_01M1YDR9VFH9FNSXXBX5XJWQAH`). These observations do not certify newer source changes or close the gates below.

Review fixes awaiting rebuilt live verification: renewable host leases with loss-triggered process cancellation, accurate discovery provenance, and status-class drift comparison.

Remaining acceptance review must cover crash-safe request reservations, earlier/completed drift baseline selection, explicit live httpx cancellation, changed/unchanged drift, and M3 retry/lease recovery deduplication. The current live marker alone does not cover all those requirements. Do not close M3 or change roadmap totals until they are resolved and verified.

- [ ] G0: this ledger states executable outcomes that can fail
  CHECK: node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M3.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: M3 source contracts enforce graph ordering, scope, budgets, canonicalization, inventory persistence, and tool containment
  CHECK: node scripts/verify-m3-static.mjs
  EXPECT: KASE_M3_STATIC_VERIFIED
  EVIDENCE: pending

- [ ] G2: API, web, CLI, Prisma, Phase 0, no-AI, runtime, Compose, and worker-security regression gates pass
  CHECK: node scripts/verify-m3-recovery.mjs
  EXPECT: KASE_M3_RECOVERY_VERIFIED
  EVIDENCE: pending

- [ ] G3: the complete migration history deploys twice to fresh PostgreSQL and exposes the M3 constraints and indexes
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-m3-migrations.ps1
  EXPECT: KASE_M3_MIGRATIONS_VERIFIED
  EVIDENCE: pending

- [ ] G4: the retained Compose stack proves canonical inventory, denied discovery, hash-verified evidence, drift, shared limits, and cancellation
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m3-compose-proof.ps1 -KeepStack
  EXPECT: M3 recon proof passed:
  EVIDENCE: pending

- [ ] G5: the existing M1 and M2 live proofs still pass after M3 integration
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-m3-live-regressions.ps1
  EXPECT: KASE_M1_M2_LIVE_REGRESSIONS_VERIFIED
  EVIDENCE: pending
