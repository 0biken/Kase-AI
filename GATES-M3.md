# Gates: Kase M3 recon and canonical endpoint inventory

OWNS: GATES-M3.md, TASKS.md, README.md, apps/api/**, docker-compose.yml, docs/**, fixtures/**, infra/**, package.json, packages/db/**, pnpm-lock.yaml, scripts/**, workers/**

Scope: deliver the durable, scope-safe Katana/httpx recon pipeline, canonical persisted inventories, cross-audit drift, API access, and retained-stack proof without regressing M1 or M2.

## Closeout — 2026-09-08

All six gates passed against the reviewed source and freshly rebuilt Node 22.14.0 images. The retained-stack proof covers crash-safe request reservations, the correct earlier completed drift baseline, changed and unchanged drift, duplicate-free lease recovery, and live cancellation of both Katana and httpx. M1 and M2 live proofs also passed against those images. The retained Compose stack remains available for inspection.

- [x] G0: this ledger states executable outcomes that can fail
  CHECK: node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M3.md
  EXPECT: LINT OK
  EVIDENCE: 2026-09-08; PowerShell in repository root; exit 0; `LINT OK`.

- [x] G1: M3 source contracts enforce graph ordering, scope, budgets, canonicalization, inventory persistence, and tool containment
  CHECK: node scripts/verify-m3-static.mjs
  EXPECT: KASE_M3_STATIC_VERIFIED
  EVIDENCE: 2026-09-08; PowerShell in repository root; exit 0; `KASE_M3_STATIC_VERIFIED`.

- [x] G2: API, web, CLI, Prisma, Phase 0, no-AI, runtime, Compose, and worker-security regression gates pass
  CHECK: node scripts/verify-m3-recovery.mjs
  EXPECT: KASE_M3_RECOVERY_VERIFIED
  EVIDENCE: 2026-09-08; Node heap 4096 MiB; exit 0; `KASE_M3_RECOVERY_VERIFIED`; API 43 suites/296 tests, web 4 suites/34 tests, CLI 7 tests; log SHA-256 `2f9e20a37d52ac341c615b7ba3803b03d44eac22db52566e82fbf4a593f2b8f6`.

- [x] G3: the complete migration history deploys twice to fresh PostgreSQL and exposes the M3 constraints and indexes
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-m3-migrations.ps1
  EXPECT: KASE_M3_MIGRATIONS_VERIFIED
  EVIDENCE: 2026-09-08; isolated Compose project and fresh volume; exit 0; all six migrations applied, second deploy idempotent, constraints/indexes/timestamp types inspected; `KASE_M3_MIGRATIONS_VERIFIED`; log SHA-256 `141d9f51dfac008049f9253cd761044cc84be0337323ac732da1780f6000ee0b`.

- [x] G4: the retained Compose stack proves canonical inventory, denied discovery, hash-verified evidence, drift, shared limits, and cancellation
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m3-compose-proof.ps1 -KeepStack
  EXPECT: M3 recon proof passed:
  EVIDENCE: 2026-09-08; freshly rebuilt retained stack; exit 0; `M3 recon proof passed:` audit `aud_01M20CTPNA9NPSP6SK33G4E7K1`, drift audit `aud_01M20CYRVMM7VGE1T1NMEJY69J`, recovered audit `aud_01M20D4FQ11H66YFZ66HYMC6RJ`, Katana-cancelled audit `aud_01M20D9M6B9EAJAGKMRA1XQN74`, httpx-cancelled audit `aud_01M20DB0H7AJBXK04PV91QWK2R`; recovered Katana attempt count 2; request ledger reserved 0/consumed 514/recon limit 800; crawl SHA-256 `6e6cdf060c67792ca2f3885db29746c3a2732116ceb319c76d8d4f94022f40de`; httpx SHA-256 `f91ef6986d4aa3309e37e0f88f84828b55ab9d29464bf088fe738062c938e2c0`; log SHA-256 `baefadd1a759b0ed9b28c54790105d5a66b26c25aff39aaea3f3f2a5119f3d63`.

- [x] G5: the existing M1 and M2 live proofs still pass after M3 integration
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-m3-live-regressions.ps1
  EXPECT: KASE_M1_M2_LIVE_REGRESSIONS_VERIFIED
  EVIDENCE: 2026-09-08; same retained rebuilt images; exit 0; `KASE_M1_M2_LIVE_REGRESSIONS_VERIFIED`; M1 audit `aud_01M20DFQJ0F015HQNS0HZ6R6JW`, denied audit `aud_01M20DGC8YWZ6824PQSFNNDJJK`; M2 audit `aud_01M20DHMDCEZ5K1TMWBBAJG0A4`, cancelled audit `aud_01M20DMM6MG1SC3K1H1F0K194R`, tombstone `evidence_cde35ef849e6deb4c30388f7ec`; log SHA-256 `de8c4910543f726fba93d5052da6d82267ab36833e85b0e6750e4b92e48c1568`.
