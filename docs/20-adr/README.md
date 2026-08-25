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

## Template

```markdown
## ADR-NNN — <decision>

**Context.** What forced the decision.

**Decision.** What was chosen.

**Rejected.** What was considered and why it loses.

**Consequence.** What this now requires or enables.
```
