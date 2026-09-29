# M4 repair checkpoint — 22 September 2026

M4 remains open. This checkpoint does not claim that all 20 review findings, the independent implementation scope, or the original acceptance gates are complete.

The current local provider/worker proof passes 28 tests with zero skips, the complete local API suite passes 386 tests with zero skips, and TypeScript checking passes. The deterministic G5 provider/driver tests pass 3 tests, and the generated isolated Compose graph validates. Prisma validation and client generation passed at the preceding checkpoint; no schema changes were made in this continuation. The G5 live launch and G6 script fail explicitly with unmet prerequisites, without a success marker. Full acceptance requirements remain separate from the local test subsets in [GATES-M4.md](GATES-M4.md).

| Local proof | Passed cases | Evidence |
|---|---:|---|
| Providers and deterministic dependency isolation (22 September) | 28 | [.m4-proof/local/G1.json](.m4-proof/local/G1.json) |
| Graph, budgets, cancellation and continuation (22 September) | 29 | [.m4-proof/local/G2.json](.m4-proof/local/G2.json) |
| Capability and worker security controls (22 September) | 30 | [.m4-proof/local/G3.json](.m4-proof/local/G3.json) |
| Configuration, evidence and methodology (22 September) | 26 | [.m4-proof/local/G4.json](.m4-proof/local/G4.json) |
| Complete local API regression suite (22 September) | 386 | [.m4-proof/local/API-regressions.json](.m4-proof/local/API-regressions.json) |
| Deterministic G5 driver and topology | 3 | `node --test scripts/m4-compose-driver.test.mjs` |

These suites overlap; their counts must not be added. Each JSON record includes the revision, source digest, timestamp, exit status and test counts. The source digest covers `apps/api/src`, including uncommitted code; it does not certify a built image or a database migration.

Repairs in this continuation include:

- Deployable M4 migration with explicit legacy-map treatment and required provenance for new maps; frozen catalog context/output limits.
- Conservative provider reservations, duplicate-dispatch denial, configured role thresholds and repository-context accounting.
- Monotonic lease attempt identifiers across child continuations, with continuation counts separate from retry consumption.
- Finish acknowledgement persisted before terminal state, child recovery without redispatch, and degraded completion for empty/blocked coverage.
- Validated invocation arguments persisted for child workers, evidence integrity/expiry tests, and complete methodology file-set checks.
- Structured tool arguments and results now use JSON-preserving redaction; oversized structured state fails explicitly rather than truncating into invalid JSON.
- Methodology deployment for both API and agent worker, read-only checkout mount, explicit SDK proxy configuration and proxy-only upstream connectivity. These containment changes are not yet live-tested.
- The recon worker composition now registers the HTTP child-job consumer used by `run_http_probe`.
- Blackbox graphs no longer require the whitebox-only code map, allowing target-only audits to reach the agent after inventory discovery.
- Capabilities now reject terminal/cancelled audits, mismatched reproduction evidence, blackbox source locations and unbounded identity reads; source proposals remain unverified and caught infrastructure errors are redacted.
- The isolated G5 driver now derives a unique production-shaped stack, creates encrypted test credentials through the API, drives two HTTP child continuations through a deterministic OpenAI-compatible fixture, asserts findings/evidence/usage/terminal state, and defines independent replay plus positive/negative network controls. Its success record explicitly excludes crash/cancellation and G6.
- Deterministic no-AI regression now checks executable graphs and dependency isolation with a positive agent control. Runtime SDK/parser/validation dependencies are classified as runtime dependencies.
- Checklist totals recalculated from checkboxes: 59/130 overall; M4 remains 1/15.

Remaining independent work and evidence:

1. The local agent-worker dependency/boot and provider protocol proof is complete: both installed SDKs pass two-turn loopback HTTP/SSE exchanges, HTTP 429, abort, malformed/unterminated stream, refusal and output-truncation controls. Nest boots the real agent-worker module with both consumers and closes it cleanly, while database, Redis and S3 transports are isolated. These tests use only synthetic credentials. Production-worker and live-stack proof remains part of G5.
2. Execute the new `scripts/m4-database-proof.mjs` runner for clean/M3-upgrade migrations, concurrent PostgreSQL reservations, duplicate settlement, conservative recovery, cancellation/deadline denials, provenance constraints and Redis reachability. Its syntax and TypeScript checks pass, but Docker readiness failed before execution. Lease-expiry, process-crash and scheduler/Redis continuation scenarios still need broader integration coverage.
3. Execute the isolated G5 happy path through real workers, evidence storage, independent replay and network controls. The driver is implemented and its topology validates, but it has not run because Docker is unavailable. Extend the live driver with controlled agent-worker crash recovery and cancellation during an in-flight provider turn before closing G5.
4. Run the complete cross-project M1–M4 live regression workflow. The 386-test result is the API suite, not that entire workflow.
5. Complete the remaining runtime/API/security review against all original findings before claiming implementation closure.

Docker was rechecked outside the sandbox on 22 September: the `dockerDesktopLinuxEngine` named pipe is absent. The disposable proof exits nonzero at readiness before touching a database. No clean-install/upgrade migration or live-stack result is claimed, and the development database was not migrated.

G6 is deferred as requested. Its unresolved configuration is:

- `KASE_OPENAI_BASE_URL` and `KASE_ANTHROPIC_BASE_URL` with the correct Router protocol paths;
- `KASE_AGENT_ROUTER_HOSTS` plus matching verified Squid allowlist destinations;
- exact `KASE_M4_OPENAI_MODEL_ID` and `KASE_M4_ANTHROPIC_MODEL_ID`, catalog revisions and a selected pinned discovery model;
- verified project-secret or explicitly enabled platform credential modes for both providers. Previously found key declarations are not proof of validity or Router access.

Once the independent work is complete and Router configuration is available, resume the G6 proof: both real tool exchanges, one bounded unaided vulnerable-fixture audit, the same-model ownership-fixed negative control, independent HTTP replay, persisted evidence/usage/terminal state and final regressions. No direct-provider substitution and no repeated discovery attempts to obtain a passing result.

Ledger: six local/structural checks met, six full acceptance gates unmet, no abandonment. M4 must not be marked complete from this checkpoint.
