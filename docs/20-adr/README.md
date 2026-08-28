# 20 — Architecture Decision Records

The decisions that changed the design, and why. Each records what was rejected as well as what was chosen.

---

| ADR | Decision | Status |
|---|---|---|
| [001](#adr-001--ai-proposes-kase-validates) | AI proposes, Kase validates | Accepted |
| [002](#adr-002--gate-on-evidence-class-not-confidence-score) | Gate on evidence class, not confidence score | Accepted |
| [003](#adr-003--build-provenance-binds-target-to-commit) | Build provenance binds target to commit | Accepted |
| [004](#adr-004--fingerprints-exclude-ai-prose-and-line-numbers) | Fingerprints exclude AI prose and line numbers | Accepted |
| [005](#adr-005--correlate-before-semantic-dedup) | Correlate before semantic dedup | Accepted |
| [006](#adr-006--runtime-route-dump-over-static-parsing) | Runtime route dump over static parsing | Accepted |
| [007](#adr-007--partial-is-a-distinct-gate-outcome) | PARTIAL is a distinct gate outcome | Accepted |
| [008](#adr-008--capability-shaped-tools-never-command-shaped) | Capability-shaped tools, never command-shaped | Accepted |
| [009](#adr-009--absence-is-not-a-fix) | Absence is not a fix | Accepted |
| [010](#adr-010--cut-ffuf-add-nuclei) | Cut ffuf, add nuclei | Accepted |
| [011](#adr-011--the-skills-are-source-material-not-runtime) | The skills are source material, not runtime | Accepted |
| [012](#adr-012--typescript-orchestrator-polyglot-tool-layer) | TypeScript orchestrator, polyglot tool layer | Accepted |
| [013](#adr-013--rs256-sessions-sha-256-tokens-flat-roles-invite-only) | RS256 sessions, SHA-256 tokens, flat roles, invite-only | Accepted |
| [014](#adr-014--k6-in-v1-behind-explicit-authorization) | k6 in v1, behind explicit authorization | Accepted |

---

## ADR-001 — AI proposes, Kase validates

**Context.** The two QA skills are conversational agents producing prose. A release gate needs structured, verifiable records.

**Decision.** Agents emit tool calls against a typed contract. Every output is schema-validated before persistence. Severity is recomputed centrally; agent proposals are advisory input. AI enrichment writes to separate fields and can never modify evidence.

**Rejected.** Letting agents write findings directly, then parsing their prose. Parsing free text is unreliable, and it makes the model the system of record.

**Consequence.** The system of record is Postgres plus the evidence store plus deterministic execution records. AI becomes the reasoning layer — replaceable, auditable, and bounded.

---

## ADR-002 — Gate on evidence class, not confidence score

**Context.** An earlier draft gated on `severity = critical AND confidence >= 0.90`.

**Decision.** Gate eligibility requires at least one artifact of a **replayable** evidence class: a scanner rule hit with file and symbol, a stored HTTP exchange that reproduces on replay, or a failing test. Confidence is stored as an ordinal band and never enters gate arithmetic.

**Rejected.** Numeric confidence thresholds. An LLM-emitted `0.91` is a token, not a calibrated probability; it drifts across model versions, so gate behaviour would change on unchanged code. Also rejected: requiring "≥ 2 evidence artifacts" — two screenshots of one page is two artifacts and proves nothing more than one.

**Consequence.** Blocks are objectively verifiable and re-checkable. A block comes with a request the engineer can run.

---

## ADR-003 — Build provenance binds target to commit

**Context.** Correlation maps a live endpoint to a source location. The audit probes a deployment and parses a checkout, which may be different builds.

**Decision.** Every audit resolves `BuildProvenance` before agents run: `ci_supplied` > `build_info_endpoint` > `response_header` > `assumed`. Only the first three set `verified: true`. Unverified provenance makes every correlated finding non-gate-eligible, with a visible warning.

**Rejected.** Assuming default-branch HEAD. It produces confidently wrong `file:line` — worse than no source location, because it sends engineers to the wrong place with false confidence.

**Consequence.** CI integration must pass `--commit`. The CLI and Action warn loudly when it is missing.

---

## ADR-004 — Fingerprints exclude AI prose and line numbers

**Context.** A draft fingerprint included `normalized_root_cause` and `source_location` with a line number.

**Decision.** Fingerprints are computed from deterministic inputs only: category, rule ID, normalized target, file, **enclosing symbol**, CWE. Root cause informs Level 3 similarity but never the hash. Line numbers are display-only.

**Rejected.** Including root cause — it is model-authored, so the fingerprint would change when the model rephrases, breaking history, resurfacing fixed findings as new, and silently voiding waivers. Including line numbers — any edit above the line shifts it and the finding appears new.

**Consequence.** Identity survives rewording and unrelated edits. Semgrep and CodeQL key on symbols for the same reason.

---

## ADR-005 — Correlate before semantic dedup

**Context.** A draft pipeline placed dedup before correlation.

**Decision.** Two dedup passes. Cheap exact-match dedup on ingest; correlation; then semantic and cross-audit dedup using the full fingerprint.

**Rejected.** A single dedup pass before correlation. Correlation is what supplies the source location, and source location is the strongest dedup key — deduplicating first means deduplicating findings that do not yet know where they live.

**Consequence.** One extra pass, and cross-source merging that actually works.

---

## ADR-006 — Runtime route dump over static parsing

**Context.** Correlation needs endpoint-to-handler mappings. The draft listed Express first among frameworks to parse statically.

**Decision.** Deterministic sources ranked: runtime route dump > OpenAPI > static parse > AI inference. Kase ships `kase-routemap`, an opt-in command emitting a JSON route map in CI. Static parsers are built for NestJS and FastAPI first; Express and Django follow.

**Rejected.** Static-parsing-first, and Express-first. Dynamic `app.use()`, route factories, and runtime prefix composition defeat static analysis — Express is precisely the case that needs the runtime dump, so it is the wrong place to start.

**Consequence.** Best correlation requires minor customer cooperation. That is an honest trade, and it defines the "instrumented mode" product tier.

---

## ADR-007 — PARTIAL is a distinct gate outcome

**Context.** Budget degradation skips optional AI analysis, so findings depend on budget state — and the gate depends on findings.

**Decision.** Any degradation sets `Audit.degraded`, which forces `status = 'partial'`. PARTIAL is a distinct outcome with CLI exit code 2, never collapsed into PASS. Default policy treats it as blocking.

**Rejected.** Treating a degraded audit as a normal one. A budget overrun or a crashed scanner would silently produce a green build — the exact failure this design exists to prevent.

**Consequence.** Budget exhaustion is loud and visible rather than silently permissive.

---

## ADR-008 — Capability-shaped tools, never command-shaped

**Context.** The agent needs to run tools against customer systems.

**Decision.** Each capability is individually typed and validated: `run_http_probe`, `run_sast`, `run_crawl`. No generic `run_tool({cmd})`. The agent worker has no target egress; only Tool Runner workers execute, after scope validation.

**Rejected.** A generic tool-execution capability. It rebuilds shell behind a JSON wrapper and defeats the sandboxing model entirely.

**Consequence.** Adding a tool means adding a typed capability — deliberate friction, in the right place. Prompt injection is structurally contained: an injected instruction can at most propose a call the validator rejects and logs.

---

## ADR-009 — Absence is not a fix

**Context.** Agent output is not perfectly deterministic. A finding may not reappear in the next audit.

**Decision.** A finding absent from a later audit becomes `not_reproduced`, **not** `fixed`, and remains blocking. Only an explicit regression check moves it to `fixed`. Confirmed false positives become durable, fingerprint-keyed suppressions. `accepted_risk` is separate from a time-boxed waiver.

**Rejected.** Auto-resolving on absence. A flaky crawl, a rate limit, or a slightly different agent path would open the gate on an unfixed critical.

**Consequence.** Gates stay stable despite non-deterministic agents. This is what stops teams disabling the gate in week one.

---

## ADR-010 — Cut ffuf, add nuclei

**Context.** The recon set was Katana, Playwright, httpx, gau, ffuf.

**Decision.** v1 ships Katana, httpx, Playwright, nuclei, and OpenAPI ingest. `gau` defers to v1.1. `ffuf` is cut.

**Rejected.** Shipping ffuf in v1. Brute-force content discovery is the highest-volume, most WAF-tripping, most ToS-risky, and noisiest tool in the set; making it safe needs a hard authorization gate and soft-404 calibration. `gau` queries third parties, adding external egress and out-of-scope URL risk — it waits until the scope validator has mileage.

**Consequence.** Narrower discovery, but nuclei produces deterministic, **gate-eligible** evidence. Discovery breadth that only yields advisory findings is worth less than narrower discovery that can block a release.

---

## ADR-011 — The skills are source material, not runtime

**Context.** Kase is built "around two existing skills." Their `SKILL.md` files assume an interactive assistant writing markdown to an output folder.

**Decision.** The `references/` payloads are vendored verbatim as agent methodology. The `SKILL.md` orchestration layer is replaced by the Kase agent runtime. Every audit records `agent_prompt_version` alongside the upstream skill version.

**Rejected.** Claiming Kase "hosts the skills" unchanged. The runtime requirements are incompatible — headless versus conversational, structured versus prose — and pretending otherwise hides a real maintenance fork.

**Consequence.** Upstream methodology improvements are cheap to re-vendor; the system prompt is a Kase-owned fork requiring deliberate maintenance.

---

## ADR-012 — TypeScript orchestrator, polyglot tool layer

**Context.** "Language: TypeScript" describes the application but not the tools: Semgrep and pip-audit are Python; Katana, httpx, nuclei, and gitleaks are Go.

**Decision.** TypeScript for orchestration, API, and web. Tools run as pinned binaries in per-family Docker images with digest pinning and per-class egress policy.

**Rejected.** Reimplementing tools in TypeScript, and treating containerization as an implementation detail. The worker images and their egress policy are the hard engineering in this stack; under-budgeting them is how the schedule slips.

**Consequence.** Worker images are a first-class deliverable from M1, with pinned versions recorded on every `ToolExecution` so findings stay explainable after upgrades.

---

## ADR-013 — RS256 sessions, SHA-256 tokens, flat roles, invite-only

**Context.** 02-stack §5 and 14-api §2 specify the auth *shape* — a single `AuthGuard` for two credential types, a `ProjectScopeGuard`, tokens "hashed at rest" — but not the algorithms, and there was no auth ADR. Four choices had to be made before any guard could be written.

**Decision.**
- **RS256, asymmetric.** Next.js signs the session JWT with a private key; Nest verifies with the public half only ([jwt-keys.ts](../../apps/api/src/auth/jwt-keys.ts) has no way to load a private key — that's deliberate, not an oversight). `algorithms: ['RS256']` is pinned explicitly in the verify call, not read from the token's own header, which is what stops the classic alg-confusion forgery (an attacker HMAC-signing with the — necessarily public — RSA public key, hoping a naive verifier trusts the header's claimed algorithm).
- **SHA-256 for API tokens**, not a password hash. A Kase token is 30 bytes of CSPRNG output; brute force is already infeasible, so a memory-hard hash buys nothing and only adds latency on a path budgeted at 600 req/min (14 §11). The hash is looked up via a unique DB index, never compared byte-by-byte against attacker-supplied input, so there is no timing side-channel to defend against with a constant-time comparison either.
- **Flat roles, not a hierarchy.** `viewer | operator | approver | admin` is checked by set membership everywhere (`RolesGuard`, [roles.ts](../../apps/api/src/auth/roles.ts)). 14 §2 keeps `approver` a peer of `operator` specifically so `require_separate_approver` on waivers holds; a rank comparison would silently let `admin` (or any role ranked above `approver`) satisfy an approver-only check, defeating the reason the role exists.
- **Invite-only org provisioning.** An OAuth identity, by itself, never grants access — deferred to PR C, decided here because it shapes the auth model this PR builds on.

**Rejected.**
- HS256 with a shared secret — simpler, but a compromised API process could then mint a session for any user; RS256 means a compromised API can verify but never forge.
- Argon2id / bcrypt for tokens — correct for low-entropy human passwords, wasted on high-entropy random tokens, and the wrong trade on a hot path.
- A ranked role hierarchy — reads naturally but is the one design that quietly breaks `require_separate_approver`.
- Domain-based auto-join (anyone with a `@company.com` email joins automatically) — rejected because Apple's private-relay addresses (`@privaterelay.appleid.com`) never match a corporate domain, and because it trusts the OAuth provider's email verification as an authorization decision rather than an identity claim.

**Consequence — provisioning.** Sign-in is gated on an `Invite` row matching the provider's *verified* email. Email verification is read per-provider, not generically: Google sends a boolean, Apple sends the **string** `"true"`/`"false"` (so a truthiness check treats `"false"` as verified), and GitHub's provider already resolves only primary-verified addresses. An unrecognised provider fails closed. Acceptance creates the `User`, its `ProjectMember` rows, and marks the invite used in one transaction.

Providers are configured from `KASE_`-prefixed env and are **individually skippable**, so a deployment missing Apple credentials serves Google and GitHub rather than failing to boot — Apple's prerequisites (paid developer account, `.p8` key, a client secret that is itself a JWT expiring within 6 months, and no `localhost` redirect) are the ones most likely to be absent.

GitHub sign-in requests `read:user user:email` only — deliberately **not** `repo`. Repository access is a separate credential (`Repository.credentialId`); bundling it into the login grant would give Kase read access to every private repository of everyone who signs in.

**Consequence.** A session user has no role on any project until a `ProjectMember` row exists. `POST /projects` therefore auto-enrolls its creator as that project's `admin` inside the same transaction ([projects.service.ts](../../apps/api/src/projects/projects.service.ts)) — without it, the user who just created a project would fail `ProjectScopeGuard` on every following request to it. Creating and listing projects (`POST`/`GET /projects`) are marked `@OrgScope()` rather than project-scoped, since a project cannot be project-scoped before it exists; only a session principal may call them; an API token — always scoped to one existing project — cannot.

---

## ADR-014 — k6 in v1, behind explicit authorization

**Context.** [19 §5](../19-roadmap/README.md) cut k6 from v1 on two grounds: *"rarely gate-blocking; highest incident risk of any adapter."* This ADR reverses that. It exists because the cut was a recorded decision, and reversing one without a record is the failure mode ADR-001 through ADR-013 were written to avoid.

The second ground — incident risk — was never wrong and is not now dismissed. k6 remains the only adapter whose *purpose* is to degrade the target. What changed is that the containment it needed now exists rather than being hypothetical: the scope validator enforces a global RPS ceiling across concurrent audits ([17 §3](../17-security/README.md#3-scope-validation)), attestation is mandatory and expires, and `destructiveAllowed` already gates a separate class of dangerous operation with a named authorizer.

The first ground — rarely gate-blocking — is answered by not letting it block at all. Evidence-class gating ([ADR-002](#adr-002--gate-on-evidence-class-not-confidence-score)) already decides this without a special case: a load profile is not reproducible run-to-run, so k6 evidence is non-replayable, and [12 §3](../12-policy-gate/README.md#3-evidence-class-gating) is absolute that non-replayable evidence warns and never blocks.

**Decision.** Ship k6 in v1 as `run_load_test`, **advisory by default**, with every cap enforced by the orchestrator rather than the adapter:

- Blocked against `environment: 'production'` unless `destructiveAllowed` **and** a separate attestation naming that target.
- VU count and duration capped by gate policy; the adapter cannot raise its own ceiling.
- Shares the audit's global RPS budget — a load test gets no exemption from the limit every other adapter obeys.
- Aborts on a target error-rate spike.
- Never gate-blocking. An SLO budget in the gate policy determines whether a finding is *raised*, not whether it can block.

**Rejected.** Keeping it cut to v1.1 — defensible, and it was the prior decision, but the machinery the cut was waiting on is the machinery that now exists, so the deferral had stopped buying anything. Making an SLO breach gate-blocking — tempting, since a declared budget feels like a stated commitment, but it would carve an exception into ADR-002, and "only replayable evidence blocks" stops being a rule the moment it has exceptions. Letting the adapter own its own caps — the component that benefits from a higher ceiling is the wrong place to enforce one.

**Consequence.** k6 output is `test_output` evidence, marked **not replayable**, so it can never satisfy the replayable-evidence clause in the gate formula ([09 §8](../09-findings/README.md#8-gate-eligibility)). Declaring an SLO budget makes a breach *reportable against a number the project committed to* rather than one the tool invented; it does not make the evidence replayable, and those are separate properties that are easy to conflate.

This leaves `lighthouse` ([07 §4.6](../07-tool-adapters/README.md)) as the remaining adapter whose entry still reads "advisory unless the project explicitly opts in with a fixed budget" — phrasing that implies a blocking path §3 does not actually allow. Same conflation, pre-dating this ADR; flagged here rather than silently changed, since narrowing an existing adapter's semantics is its own decision.

Production load testing now has two independent authorizations — `destructiveAllowed` and a target-specific attestation — which is deliberate friction. A load test against production that nobody explicitly authorized is the incident this ADR is accountable for preventing.

---

## Template

```markdown
## ADR-NNN — <decision>

**Context.** What forced the decision.

**Decision.** What was chosen.

**Rejected.** What was considered and why it loses.

**Consequence.** What this now requires or enables.
```
