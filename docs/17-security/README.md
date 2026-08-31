# 17 — Security Model

Threat model, sandboxing, scope enforcement, authorization.

---

## 1. Kase is a high-value target

Kase holds repository access, production credentials, and the vulnerability inventory of every customer it audits. A compromised Kase is a compromise of every project connected to it. The security model is not a compliance chapter — it is a functional requirement.

## 2. Threat model

| # | Threat | Mitigation |
|---|---|---|
| T1 | Audit used to attack a third party | Scope validator, host allowlist, mandatory authorization attestation ([§3](#3-scope-validation)) |
| T2 | Prompt injection via crawled content or source | Agent has no target egress; every capability scope-validated; data framing ([05 §7](../05-agent-runtime/README.md#7-agent-isolation)) |
| T3 | Malicious repository executes code during analysis | No build, no install, no test execution by default; read-only mount; sandboxed worker ([§5](#5-repository-analysis-is-read-only)) |
| T4 | Credential leakage into evidence or logs | Capture-time redaction, registered secrets, pattern matching ([08 §5](../08-evidence/README.md#5-redaction)) |
| T5 | Audit degrades or takes down a customer system | Rate limits, request budgets, destructive-op gating ([§6](#6-non-destructive-by-default)) |
| T6 | Cross-project data leakage | Project-scoped authorization on every query; per-project storage prefixes |
| T7 | Findings inventory exfiltrated | Evidence access audited; short-lived pre-signed URLs; encryption at rest |
| T8 | Gate bypassed to ship a known vulnerability | Immutable policy versions; waivers require approval, expire, and are logged |
| T9 | Supply-chain compromise of a bundled tool | Pinned versions, digest-pinned images, checksum verification |

## 3. Scope validation

Every outbound request, from any worker, passes the validator. There is no bypass path.

```ts
scopeValidator.check(url, context) => {
  allowed: boolean
  reason?: 'host_not_allowed' | 'path_denied' | 'rate_exceeded'
         | 'budget_exceeded' | 'destructive_not_authorized'
}
```

### Rules

| Rule | Enforcement |
|---|---|
| Host must match `allowedHosts` | Exact or single-label wildcard. Bare TLDs and `*` rejected at policy creation |
| Private ranges denied unless the target is explicitly local | Blocks SSRF pivoting into internal networks |
| Redirects re-validated | A redirect to an out-of-scope host is not followed |
| **Discovered URLs re-validated** | Recon output is untrusted input ([06 §5](../06-recon/README.md#5-every-discovered-url-re-enters-the-scope-validator)) |
| Rate limit per target host, **global across audits** | Two concurrent audits must not sum to 2× the agreed RPS |
| Request budget decremented per request | Counted on `ToolExecution` |
| Denials logged with source | High denial counts usually mean the allowlist is too narrow |

### Authorization attestation

A project cannot be created without a named person attesting authorization to test the target. Attestations are recorded with identity and timestamp and go stale after 12 months, requiring renewal. Production targets require re-attestation on target change.

This is standard practice for real engagements, and it is the record that matters if an audit is ever questioned.

## 4. Network egress policy

Each worker class gets the narrowest egress that lets it work.

| Worker | Target | Internet | Notes |
|---|---|---|---|
| `worker-recon` | Yes (scoped) | No | Katana, httpx, nuclei |
| `worker-browser` | Yes (scoped) | No | Playwright; asset loading confined to target hosts |
| `worker-sast` | **No** | No | Fully offline; rule bundles baked into the image |
| `worker-deps` | No | Advisory DBs only, allowlisted | OSV, npm registry |
| `worker-agent` | **No** | LLM provider only, allowlisted | Cannot touch the customer's system |

The agent worker having no target egress is the structural control that makes prompt injection survivable: a successful injection can propose a request, but only the Tool Runner can issue one, and it validates first.

Egress is enforced at the container network layer, not in application code.

## 5. Repository analysis is read-only

Cloning and analyzing a repository must never execute code from it.

| Rule | Reason |
|---|---|
| No `npm install`, `pip install`, or any package manager | `postinstall` scripts are arbitrary code execution |
| No build step | Build scripts are arbitrary code execution |
| No test execution by default | Opt-in per project, and only in a network-isolated worker |
| Read-only bind mount | Analysis cannot modify the checkout |
| Non-root user, dropped capabilities, seccomp profile | Standard container hardening |
| Filesystem and process quotas | Zip bombs, fork bombs, disk exhaustion |
| No Docker socket | Never |

Semgrep, gitleaks, and the Code Map builder are all static readers. Dependency scanning reads manifests and lockfiles and queries advisory databases; it does not resolve or install.

Where a project opts into running its own test suite, that runs in a dedicated worker with no network and a hard timeout, and its failure never blocks the audit.

## 6. Non-destructive by default

`ScopePolicy.destructiveAllowed` defaults to `false`.

With it false, the following are blocked at the validator:

- non-idempotent HTTP methods against production targets (`DELETE`, and `POST`/`PUT`/`PATCH` outside explicitly declared safe paths),
- nuclei templates tagged intrusive or destructive,
- load testing,
- any capability an adapter marks destructive.

Enabling it requires an explicit, separately attested authorization recording who authorized it and for which target. Production targets carry an additional confirmation.

The agent can request destructive capability via the tool contract; the request is denied and logged, exactly like an out-of-scope request.

## 7. Secrets

Detailed in [02 §4](../02-stack/README.md#4-secrets-management-is-a-first-class-requirement). Summary of the invariants:

- Envelope encryption; a fresh data key per immutable secret version, wrapped through a portable key-encryption provider; ciphertext in Postgres.
- Local development uses `KASE_LOCAL_KEK`. Production binds the provider to a cloud KMS without changing the secret model.
- Decrypted only in the worker that needs the value, at job start.
- Never written to a persistent filesystem, baked into images, or placed in a persisted job payload. Tool files exist only in `/run/kase-secrets` tmpfs for the duration of a job.
- Registered with the redactor before any tool runs.
- Rotation and revocation are API operations.
- Never in argv — process lists and CI logs capture argv.

## 8. Multi-tenancy

v1 is single-organization, but the isolation primitives are built in from the start because retrofitting them is not practical:

| Boundary | Mechanism |
|---|---|
| Data | Project ID on every row; `ProjectScopeGuard` on every request; no unscoped queries |
| Storage | Per-project S3 prefix with prefix-scoped IAM |
| Workers | No shared mutable state between jobs; fresh container per job |
| Secrets | Per-project data keys |
| LLM context | Contexts assembled per audit; no cross-project retrieval |

## 9. Audit trail

Immutable, append-only, retained indefinitely.

Recorded events:

- authentication and authorization decisions,
- project, scope policy, and gate policy changes (with diffs),
- audit start, cancel, and completion,
- **every scope denial**, with the requesting component and the source of the URL,
- every `request_scope_change` call from an agent,
- evidence access and download,
- finding lifecycle transitions with actor,
- waiver request, approval, and expiry,
- integration actions,
- secret create, rotate, revoke (never values).

## 10. Responsible disclosure

Kase generates vulnerability inventories. Findings are treated as customer-confidential:

- Reports are never sent to third parties without explicit action by the customer.
- Jira and GitHub issues carry only what the project has configured.
- Evidence downloads are audited and short-lived.
- Support access to customer findings requires break-glass with a logged reason.

---

**Next:** [18 — Observability](../18-observability/README.md)
