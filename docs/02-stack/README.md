# 02 — Technology Stack

Locked choices, rationale, and the two decisions that need clearing before implementation.

---

## 1. Stack table

| Layer | Choice | Notes |
|---|---|---|
| Language (orchestration) | TypeScript | Not the tool layer — see §2 |
| Backend | Node.js + NestJS | Module boundaries map to the five subsystems |
| Frontend | Next.js (App Router) | |
| Database | PostgreSQL 16 | JSONB for tool payloads, everything else relational |
| ORM | Prisma | |
| Queue | Redis + BullMQ | Job graph, retries, concurrency caps |
| Object storage | S3-compatible (MinIO locally) | Evidence artifacts |
| Workers | Docker containers, one image per tool family | |
| Browser automation | Playwright | Chromium required, Firefox/WebKit best-effort |
| Accessibility | axe-core | |
| Performance | Lighthouse CLI | |
| Crawling / recon | Katana, httpx | ProjectDiscovery, MIT |
| SAST | Semgrep OSS | **See §3 — licensing gate** |
| Secret scanning | gitleaks | |
| Dependency scanning | `npm audit`, `pip-audit`, OSV | |
| AI abstraction | Provider interface (Anthropic, OpenAI) | See [11](../11-ai-layer/README.md) |
| Secrets management | Cloud KMS + envelope encryption in Postgres | **See §4** |
| Auth | Auth.js in Next, JWT verified by NestJS | **See §5** |
| CI/CD | GitHub Actions | |
| Defect integration | Jira Cloud | |
| Observability | OpenTelemetry + structured JSON logs | |
| Local dev | Docker Compose | |

### Why TypeScript

Playwright, the Node ecosystem, GitHub Actions tooling, and API/schema tooling all sit naturally in TypeScript, and the schema-validation-heavy design (every agent output validated before persistence) benefits from Zod/`class-validator` at the boundary. The team's existing QA automation is already in this ecosystem.

## 2. The stack is polyglot, and that matters

"Language: TypeScript" describes the **orchestrator only**. The tool layer is not TypeScript:

| Tool | Runtime |
|---|---|
| Semgrep | Python |
| `pip-audit` | Python |
| Katana, httpx, nuclei | Go binaries |
| gitleaks | Go binary |
| Lighthouse, Playwright, axe | Node |

**Implication:** the hard engineering in this stack is the **worker container images and their egress policy**, not the application code. Each image must pin tool versions, carry its rule bundles offline where possible, and declare its network requirements.

Budget for this explicitly. A vague "we'll containerize the tools" line item is where this project loses a month.

```
worker-base          Alpine/Debian slim, non-root, seccomp profile
 ├── worker-recon    katana, httpx, curl, dig, openssl
 ├── worker-browser  playwright + chromium, axe-core, lighthouse
 ├── worker-sast     semgrep + pinned rulesets, gitleaks
 ├── worker-deps     node, python, osv-scanner
 └── worker-agent    node only, no target egress, LLM API egress only
```

Tool versions are pinned per image tag and recorded on every `ToolExecution` so findings remain explainable after an upgrade.

## 3. Open item: Semgrep licensing

**Status: must be cleared before Semgrep becomes load-bearing.**

The Semgrep OSS engine and the Semgrep rule registry are licensed separately. The engine is open source; the registry rulesets and anything Semgrep Pro carry their own terms, and bundling them into a commercial product is not automatically permitted.

Actions:

1. Legal review of the specific rulesets Kase intends to ship.
2. If registry rules cannot be redistributed, either (a) ship only first-party Kase rules plus permissively licensed community rules, or (b) require customers to supply their own Semgrep entitlement.
3. Keep the SAST adapter engine-agnostic so a swap remains cheap.

Swapping SAST engines after the finding schema, fingerprints, and gate policies depend on a specific rule-ID namespace is expensive. Clear this early.

Licensing of the rest of the tool set is unproblematic: Katana, httpx, nuclei, ffuf (Apache/MIT), gitleaks (MIT), axe-core (MPL-2.0), Lighthouse (Apache-2.0), Playwright (Apache-2.0).

## 4. Secrets management is a first-class requirement

Kase holds, at minimum:

- repository access tokens,
- Jira credentials,
- LLM provider API keys,
- **test-account credentials for authenticated black-box testing**,
- customer-supplied target headers and cookies.

Requirements:

- Envelope encryption: a fresh data key per secret version, encrypted through a `KeyEncryptionProvider`; ciphertext and wrapped data keys live in Postgres.
- The local provider wraps data keys with AES-256-GCM using the ignored `KASE_LOCAL_KEK` development key. Production cloud KMS bindings implement the same interface and remain a deployment choice, not an application rewrite.
- Decryption happens in the worker at job start, never in the API process. If a tool requires a file, it is materialized only in the worker's `/run/kase-secrets` tmpfs and removed when the job ends.
- Secrets are injected into workers via environment or tmpfs, never baked into images or job payloads persisted in Redis.
- All secret values are registered with the log redactor before any tool runs — see [08 — Evidence §5](../08-evidence/README.md#5-redaction).
- Rotation and revocation are API operations, not database surgery.
- Rotation inserts an immutable `SecretVersion`; revocation prevents new leases but preserves metadata and audit history.

Retrofitting this is painful. It is in the v1 P0 set.

## 5. Auth placement

Auth.js is Next-native and does not sit naturally inside NestJS. Chosen arrangement:

```
Browser -> Next.js (Auth.js: session, OAuth, CSRF)
        -> issues short-lived JWT
        -> NestJS verifies JWT signature + project scope on every request
CLI / CI -> long-lived project API token (hashed at rest) -> NestJS
```

NestJS holds a single `AuthGuard` supporting both credential types and one `ProjectScopeGuard`. Auth.js never runs server-side inside Nest.

## 6. Naming and package layout

Settled, so it stops being re-litigated per package.

| Thing | Name |
|---|---|
| Product, repository | `kase` |
| CLI binary | `kase` |
| npm scope | `@kase/*` |
| PyPI prefix | `kase-*` |
| Docker images | `kase/worker-<family>` |
| Postgres schema | `kase` |
| Env var prefix | `KASE_` |
| OTel service namespace | `kase` |

```
@kase/api            NestJS application
@kase/web            Next.js dashboard
@kase/cli            the `kase` binary
@kase/core           finding schema, severity engine, fingerprinting
@kase/adapters       tool adapter implementations
@kase/routemap-node  route dump for NestJS
kase-routemap        route dump for FastAPI/Django  (PyPI — Python targets
                     need a Python-side dumper; it cannot live in npm)
```

The tool layer is polyglot (§2), so the package namespace is too. `@kase/routemap-node` and `kase-routemap` are the same capability for different target ecosystems and must emit an identical `RouteMapping` shape — that contract is owned by [03 — Data Model](../03-data-model/README.md), not by either implementation.

**One constraint from the spikes:** `handlerSymbol` is framework-shaped — `InvoiceController.findOne` for NestJS, `fixture.app.find_one` for FastAPI. Treat it as an **opaque string**. Nothing may split it on `.` to recover a class name. See [the FastAPI spike](../../spike/correlation-fastapi/README.md#3-symbol-namespaces-are-framework-shaped-).

## 7. Concurrency and resource defaults

| Setting | Default | Rationale |
|---|---|---|
| Concurrent audits per instance | 2 | Browser workers are memory-hungry |
| Concurrent jobs per audit | 4 | |
| Browser worker memory limit | 2 GB | Chromium plus traces |
| Job timeout (default) | 10 min | Per-adapter override |
| Job timeout (load test) | 30 min | |
| Max retries | 2 | Then `failed`, audit continues |

## 8. Local development

```bash
docker compose up -d postgres redis minio
pnpm install
pnpm prisma migrate dev
pnpm dev
```

Compose brings up Postgres, Redis, MinIO, and a deliberately vulnerable sample target (see [19 — Roadmap](../19-roadmap/README.md#2-the-first-vertical-slice)) so the correlation path is exercisable without a customer system.

---

**Next:** [03 — Data Model](../03-data-model/README.md)
