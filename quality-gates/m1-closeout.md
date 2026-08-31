# Gates: Kase M1 closeout

OWNS: apps/api/**, packages/db/**, workers/**, infra/**, docker-compose.yml, scripts/m1-compose-proof.ps1, scripts/verify-m1-static.mjs, docs/**, TASKS.md

Scope: prove that M1's secret, worker-isolation, audit-dispatch, and content-addressed evidence path is complete without treating static checks as container evidence.

- [ ] G1: API, web, schema, Compose configuration, and worker security checks pass
  CHECK: node scripts/verify-m1-static.mjs
  EXPECT: KASE_M1_STATIC_VERIFIED
  EVIDENCE: pending

- [ ] G2: a real sandboxed audit persists matching evidence and denied egress fails closed
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m1-compose-proof.ps1
  EXPECT: M1 proof passed:
  EVIDENCE: pending
