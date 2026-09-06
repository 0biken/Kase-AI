# Gates: Kase M2 workspace recovery and runtime integration

OWNS: README.md, TASKS.md, package.json, pnpm-workspace.yaml, pnpm-lock.yaml, apps/api/**, apps/cli/**, packages/db/**, docs/**, rules/**, scripts/**, GATES.md

Scope: Recover the pinned workspace, integrate the API and dedicated M2 runtimes, and prove static plus fresh-migration acceptance without closing M2.

- [x] G1: the repository enforces pnpm 10.15.0, permits required build scripts, and has a generated M2 Prisma client
  CHECK: node scripts/verify-m2-toolchain.mjs
  EXPECT: KASE_M2_TOOLCHAIN_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=c30fab252da5bd2871914c6cb02a9011cc18fec07bb86a6c3fa4133392714518; output-bytes=27

- [x] G2: API, web, CLI, Prisma, Compose configuration, Phase 0 guards, and worker-security static gates pass
  CHECK: node scripts/verify-m2-recovery.mjs
  EXPECT: KASE_M2_RECOVERY_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=d4479649723103092ff65e0abe0f587b479e7d24e15a7c7b1b9bc6560112c881; output-bytes=4922

- [x] G3: a fresh isolated PostgreSQL database applies the complete migration history twice and exposes the required M2 constraints and indexes
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-m2-migrations.ps1
  EXPECT: KASE_M2_MIGRATIONS_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=45ade182a3c2/29 entries; EXPECT=matched; output-sha256=db1ba99a9b78e47a685df2e85bb7463a785930db3e0c78f194d8163b6b40ba33; output-bytes=2571

- [x] G4: final review preserves the pre-existing Phase 0/M2 work and introduces no AI runtime, model SDK, prompt, or transcript implementation
  EVIDENCE: 2026-09-05 — `git diff --check` passed; dependency/source scan found no AI runtime or provider SDK additions.

- [ ] G5: the complete static recovery gate is reproduced with the canonical Node 22.14.0 runtime and the official archive checksum is verified
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-node22.ps1
  EXPECT: KASE_M2_NODE22_VERIFIED
  EVIDENCE: pending
