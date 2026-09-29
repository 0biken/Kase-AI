# Gates: Kase M4 provider-agnostic agent runtime

OWNS: GATES-M4.md, TASKS.md, README.md, apps/api/**, docker-compose.yml, docs/**, fixtures/**, infra/**, methodology/**, package.json, packages/db/**, pnpm-lock.yaml, scripts/**, workers/**

Scope: deliver a durable, provider-neutral agent runtime for Anthropic and OpenAI with explicit opt-in audit categories, typed capabilities, budget enforcement, methodology versioning, black-box and white-box loops, and hardened agent-worker containment. M4 remains open. G1–G4 commands currently establish local behavioral subsets only; they do not certify all original gate requirements.

Status (2026-09-12): G6 live Router work is deferred by the user. Missing prerequisites are the provider-specific Router URLs, verified router hostname allowlist, exact pinned Anthropic/OpenAI model IDs and catalog revisions, and verified credential modes for both providers. Credential declarations were found previously, but their validity and Router access have not been proved. G6 also requires a selected pinned discovery model, vulnerable/fixed controls, independent replay and current complete regressions.

Docker Linux engine is unavailable (`dockerDesktopLinuxEngine` pipe absent; rechecked 14 September), so clean/upgrade database migrations, concurrent PostgreSQL/Redis recovery and G5 live-network scenarios have no current evidence. A real G5 scenario driver is still required; its legacy source-string runner now fails closed. Local green test output must not close these requirements.

- [x] G0: this ledger states executable outcomes that can fail
  CHECK: node .agents/skills/unlazy/scripts/gate-lint.mjs GATES-M4.md
  EXPECT: LINT OK
  EVIDENCE: 2026-09-12; PowerShell; repository root; exit 0; LINT OK with four expected warnings for pending full G1–G4 requirements

- [ ] G1: provider and policy contracts pass the golden contract suite
  EVIDENCE: pending; installed SDKs now pass loopback HTTP/SSE tool exchanges and HTTP 429 controls; complete worker boot and remaining protocol scenarios still require evidence

- [ ] G2: graph construction, durability, and budget enforcement pass
  EVIDENCE: pending; disposable PostgreSQL/Redis concurrency, migrations and crash recovery remain

  Database subset runner: node scripts/m4-database-proof.mjs. It creates a unique disposable Compose project, tests clean and M3-upgrade migrations, real PostgreSQL reservations/settlement/recovery and Redis reachability. On 2026-09-13 it exited nonzero at Docker readiness, before creating a stack. This runner is not the full G2 or G5 proof.

- [ ] G3: capability security fuzzing and container isolation pass
  EVIDENCE: pending; local negative and positive controls pass, but live containment remains

- [ ] G4: agent outputs, code map, finding authority, and transcript redaction pass
  EVIDENCE: pending; local persistence contracts pass, but durable DB/storage and real HTTP fixture proofs remain

- [ ] G5: live Compose proof with deterministic provider fixture
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m4-compose-proof.ps1 -KeepStack
  EXPECT: M4 agent proof passed:

- [ ] G6: real-provider proof and full M1–M4 regression suite
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m4-real-provider-proof.ps1
  EXPECT: M4 real-provider proof passed:

- [x] L1: local adapter and deterministic dependency-isolation cases pass with no skips
  CHECK: node scripts/verify-m4-provider-contracts.mjs
  EXPECT: KASE_M4_PROVIDER_CONTRACTS_VERIFIED
  EVIDENCE: .m4-proof/local/G1.json; 2026-09-14; PowerShell; repository root; exit 0; expected marker matched; 28 passed, zero skipped. Covers real loopback HTTP/SSE tool exchanges, 429, abort, malformed/unterminated stream, refusal, truncation, dependency isolation and Nest worker boot with synthetic fixture credentials.

- [x] L2: local graph, budget, cancellation and continuation cases pass with no skips
  CHECK: node scripts/verify-m4-graph-budget.mjs
  EXPECT: KASE_M4_GRAPH_BUDGET_VERIFIED
  EVIDENCE: .m4-proof/local/G2.json; 2026-09-14; PowerShell; repository root; exit 0; expected marker matched; 25 passed, zero skipped

- [x] L3: local capability and tool-worker security cases pass with no skips
  CHECK: node scripts/verify-m4-capability-security.mjs
  EXPECT: KASE_M4_CAPABILITY_SECURITY_VERIFIED
  EVIDENCE: .m4-proof/local/G3.json; 2026-09-14; PowerShell; repository root; exit 0; expected marker matched; 24 passed, zero skipped

- [x] L4: local configuration, evidence and methodology cases pass with no skips
  CHECK: node scripts/verify-m4-agent-outputs.mjs
  EXPECT: KASE_M4_AGENT_OUTPUTS_VERIFIED
  EVIDENCE: .m4-proof/local/G4.json; 2026-09-14; PowerShell; repository root; exit 0; expected marker matched; 26 passed, zero skipped

- [x] LR: complete local API Jest suite passes with no skips
  CHECK: node scripts/verify-m4-local-regressions.mjs
  EXPECT: KASE_M4_LOCAL_API_REGRESSIONS_VERIFIED
  EVIDENCE: .m4-proof/local/API-regressions.json; 2026-09-14; PowerShell; repository root; exit 0; expected marker matched; 376 passed, zero skipped; no failed suites
