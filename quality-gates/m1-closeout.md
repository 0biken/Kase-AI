# Gates: Kase M1 closeout

OWNS: apps/api/**, packages/db/**, workers/**, infra/**, docker-compose.yml, scripts/m1-compose-proof.ps1, scripts/verify-m1-static.mjs, docs/**, TASKS.md

Scope: prove that M1's secret, worker-isolation, audit-dispatch, and content-addressed evidence path is complete without treating static checks as container evidence.

- [x] G1: API, web, schema, Compose configuration, and worker security checks pass
  CHECK: node scripts/verify-m1-static.mjs
  EXPECT: KASE_M1_STATIC_VERIFIED
  CWD: ..
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=bf7cf9c3560c/29 entries; EXPECT=matched; output-sha256=b614454641b5e014bdb5decbe0d3b7ec98accd3962e851554588f9f2dc6b6800; output-bytes=3392

- [x] G2: a real sandboxed audit persists matching evidence and denied egress fails closed
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m1-compose-proof.ps1 -KeepStack
  EXPECT: M1 proof passed:
  CWD: ..
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Sandy Star\Downloads\Kase; path=bf7cf9c3560c/29 entries; EXPECT=matched; output-sha256=4581bccdac123c0f507c24717cf94e59ef5448a295d132397f109b134d3d68da; output-bytes=19880
