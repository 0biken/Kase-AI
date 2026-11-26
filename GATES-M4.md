# Gates: Kase M4 provider-agnostic agent runtime

OWNS: GATES-M4.md, TASKS.md, README.md, apps/api/**, docker-compose.yml, docs/**, fixtures/**, infra/**, methodology/**, package.json, packages/db/**, pnpm-lock.yaml, scripts/**, workers/**

Scope: deliver a durable, provider-neutral agent runtime for Anthropic, OpenAI and Gemini with explicit opt-in audit categories, typed capabilities, budget enforcement, methodology versioning, black-box and white-box loops, and hardened agent-worker containment. M4 remains open. G1–G4 commands currently establish local behavioral subsets only; they do not certify all original gate requirements.

Status (2026-09-12): G6 live Router work is deferred by the user. Missing prerequisites are the provider-specific Router URLs, verified router hostname allowlist, exact pinned Anthropic/OpenAI model IDs and catalog revisions, and verified credential modes for both providers. Credential declarations were found previously, but their validity and Router access have not been proved. G6 also requires a selected pinned discovery model, vulnerable/fixed controls, independent replay and current complete regressions.

Status (2026-11-13): G6 is rescoped by the user to **Gemini (`gemini-4-carbon`) plus one of Anthropic/OpenAI** (`KASE_M4_SECOND_PROVIDER`), with the **provider's own API host as the Agent Router** (sole entry in the agent Squid allowlist and `KASE_AGENT_ROUTER_HOSTS`, reached only via the agent egress proxy). The G6 script is now real (parts A/B/C below) and the G5 driver now includes crash-recovery and in-flight-cancellation scenarios. Neither has run live: Docker is still unavailable on this machine (rechecked 13 November) and no provider keys are configured. Every gate below remains pending.

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
  SCENARIOS: (1) happy path with two HTTP child continuations, finding, replayable evidence, independent replay and agent network positive/negative controls; (2) `worker-agent-main` killed during a held provider turn, restarted, audit completes with one finding, no active reservations, settled reservations equal successful provider calls, at least one expired reservation; (3) audit cancelled via `POST /audits/:id/cancel` during a held turn, provider request aborted, terminal `cancelled`, no finding, nothing settled. Deterministic driver/fixture tests: `node --test scripts/m4-compose-driver.test.mjs` (7 cases).
  EVIDENCE: pending; not run live (Docker unavailable)

- [ ] G6: real-provider proof and full M1–M4 regression suite
  CHECK: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/m4-real-provider-proof.ps1
  EXPECT: M4 real-provider proof passed:
  CONFIG: `KASE_M4_SECOND_PROVIDER` (anthropic|openai); `KASE_AGENT_ROUTER_HOSTS`; per provider `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `KASE_M4_<P>_MODEL_ID`, `KASE_<P>_BASE_URL`; optional `KASE_M4_<P>_CONTEXT_LIMIT`/`_OUTPUT_LIMIT` (conservative defaults 200000/16000).
  PARTS: A live two-turn tool exchange per provider, every event schema-validated, Gemini thought signature echoed (`pnpm --filter @kase/api test:live`, no Docker); B per provider one unaided `full`/`blackbox` audit of the vulnerable fixture that must produce an authorization finding with replayable HTTP evidence plus independent replay, then the same model against the ownership-fixed fixture (spike's one-token `findScoped` fix mounted read-only) that must produce none (`node scripts/m4-compose-driver.mjs --real-provider <p>`); C local M1–M4 regressions. One bounded attempt per step.
  EVIDENCE: pending; script fails closed at missing configuration (verified 2026-11-13); part A runner (`apps/api/src/ai-provider/provider.live.ts`, `jest.live.config.js`) is in place and fails fast without configuration; no real provider pass yet (no keys)

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
