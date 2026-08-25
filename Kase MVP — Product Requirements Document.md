# Kase MVP — Product Requirements Document

**Product:** Kase  
**Version:** MVP v1.0  
**Status:** Product Definition — **superseded by [docs/](docs/README.md) for technical design**  
**Product Type:** AI-powered QA auditing and release-assurance platform  
**Primary Users:** QA Engineers, Software Engineers, Security Engineers, Engineering Leads  
**Core Capabilities:** Black-box QA, White-box QA, evidence collection, finding correlation, reporting, CI/CD release gates

---

> ## Document status
>
> This PRD is the **original product-definition draft**. It is preserved as-is for history and for the product goals, users, and scope decisions it defines — those still hold.
>
> **For current technical design, the [`docs/`](docs/README.md) tree is the single source of truth.** A technical review of this PRD surfaced several places where the design as originally written would have been unsafe or untrustworthy in a CI release gate — most importantly, gating on an AI-emitted confidence score, correlating findings without confirming the audited deployment matched the audited source commit, and no distinct outcome for a degraded/incomplete audit. `docs/` corrects these and adds the subsystems needed to make them possible (build provenance, evidence-class gating, the recon/endpoint-inventory layer, waivers with mandatory expiry). The full list of deltas, each with what was rejected and why, is in [`docs/20-adr/`](docs/20-adr/README.md).
>
> | This PRD (original) | Current design (`docs/`) |
> |---|---|
> | § 12 Data Model, § 16 AI Architecture | [03 — Data Model](docs/03-data-model/README.md) |
> | § 17 Tool Execution Security Model | [05 — Agent Runtime](docs/05-agent-runtime/README.md), [17 — Security](docs/17-security/README.md) |
> | § 18 MVP Release Gate Policy | [12 — Policy Engine & Release Gate](docs/12-policy-gate/README.md) — see [ADR-002](docs/20-adr/README.md#adr-002--gate-on-evidence-class-not-confidence-score), [ADR-007](docs/20-adr/README.md#adr-007--partial-is-a-distinct-gate-outcome) |
> | § 19 Evidence Correlation (FR-019) | [10 — Correlation Engine](docs/10-correlation/README.md) — see [ADR-003](docs/20-adr/README.md#adr-003--build-provenance-binds-target-to-commit) |
> | § 18 Finding Deduplication (FR-018) | [09 — Finding Engine](docs/09-findings/README.md) — see [ADR-004](docs/20-adr/README.md#adr-004--fingerprints-exclude-ai-prose-and-line-numbers), [ADR-009](docs/20-adr/README.md#adr-009--absence-is-not-a-fix) |
> | § 22 Recommended Technical Architecture | [01 — Architecture](docs/01-architecture/README.md), [02 — Stack](docs/02-stack/README.md) |
> | *(not present in this PRD)* | Recon & Endpoint Inventory — [06](docs/06-recon/README.md) |
> | *(not present in this PRD)* | Roadmap and first vertical slice — [19](docs/19-roadmap/README.md) |
>
> Section numbers, FR IDs, and diagrams below are left exactly as originally written.

---

# 1. Executive Summary

Kase is an AI-powered software quality platform built around two existing QA intelligence modules:

1. **Black Box QA Skill** — audits a live website, web application, or API from the outside using reconnaissance, functional testing, security testing, accessibility, performance, UX, resilience, and related QA techniques.

2. **White Box QA Skill** — audits a source-code repository from the inside, covering code structure, static security analysis, secrets, dependency vulnerabilities, authentication and authorization logic, input validation, error handling, code quality, test coverage, and infrastructure-as-code.

The existing skills are designed around an evidence-led audit model in which findings must contain severity, reproduction, impact, and concrete remediation rather than merely identifying defects. The White Box skill additionally requires source-grounded precision such as exact file and line references. 
Kase MVP will provide the **execution and orchestration layer around those skills**.

The MVP will allow a user to connect a repository and application target, configure an audit, execute both black-box and white-box checks through a controlled tool-adapter system, collect raw evidence, normalize and correlate findings, generate an actionable QA report, create Jira/GitHub artifacts, and enforce a configurable CI/CD release gate.

The MVP is intentionally not a full enterprise testing platform. Browser/device farms, advanced self-healing, multi-tenant enterprise governance, large-scale test management, native mobile automation, and advanced AI-agent testing are deferred.

---

# 2. Product Vision

Kase should become the intelligence layer between:

**Software → Tests → Evidence → Findings → Remediation → Regression → Release**

The long-term vision is:

```text id="x9h6j3"
                         QA FORGE
                      AI QA PLATFORM
                           │
              ┌────────────┴────────────┐
              │                         │
       BLACK BOX SKILL            WHITE BOX SKILL
              │                         │
              └────────────┬────────────┘
                           │
                     TOOL ADAPTERS
                           │
              ┌────────────┼────────────┐
              ↓            ↓            ↓
        Browser/API     Source       Performance
        Testing         Analysis     Analysis
              │            │            │
              └────────────┼────────────┘
                           ↓
                    EVIDENCE STORE
                           ↓
                  FINDING CORRELATION
                           ↓
                     AI ANALYSIS
                           ↓
                 REPORT + INTEGRATIONS
                           ↓
                      RELEASE GATE
```

---

# 3. Problem Statement

Modern QA processes are fragmented across:

- Browser automation tools.
- API testing tools.
- Static analysis tools.
- Security scanners.
- Accessibility scanners.
- Performance tools.
- Test management platforms.
- CI/CD systems.
- Jira or other defect-management systems.
- AI coding assistants.

These tools produce large amounts of output but generally do not provide a single reasoning layer that answers:

> What is actually wrong, how was it proven, why is it happening, what is its real impact, how should it be fixed, and should the release be allowed to proceed?

Kase addresses this problem by combining:

**Black-box evidence + white-box evidence + AI reasoning + release automation.**

---

# 4. Goals

## 4.1 Primary Goals

The MVP must:

1. Allow a user to register a project.
2. Accept a live application/API target.
3. Accept a source-code repository.
4. Configure an authorized audit scope.
5. Execute the existing Black Box QA skill.
6. Execute the existing White Box QA skill.
7. Execute selected external QA/security tools through adapters.
8. Collect raw evidence from every execution.
9. Normalize findings into a common schema.
10. Deduplicate related findings.
11. Correlate black-box findings with white-box evidence.
12. Generate an executive summary and technical report.
13. Integrate with GitHub.
14. Create Jira issues from findings.
15. expose a configurable release gate.
16. Run from CI/CD.
17. Preserve audit history.

## 4.2 Secondary Goals

The MVP should also:

- Detect the project's technology stack.
- Select relevant audit categories automatically.
- Support partial audits.
- Support smoke versus full audit modes.
- Track audit execution status.
- Track tool failures separately from QA failures.
- Allow users to rerun failed checks.
- Preserve raw evidence for later review.

---

# 5. Non-Goals for MVP

The following are explicitly out of scope for MVP:

- Native iOS automation.
- Native Android automation.
- Large-scale real-device infrastructure.
- SaaS multi-tenancy.
- Enterprise SSO.
- Advanced RBAC.
- Full test management replacement.
- Advanced self-healing.
- Autonomous code merging.
- Autonomous production remediation.
- Unlimited load testing.
- Distributed high-volume performance testing.
- Full visual regression platform.
- AI/LLM application evaluation.
- Agentic application testing.
- Complete browser/device cloud.
- Full compliance certification such as SOC 2 certification.

These belong to post-MVP phases.

---

# 6. Target Users

## 6.1 QA Engineer

Needs to:

- Run comprehensive audits.
- Investigate failures.
- Review evidence.
- Generate tickets.
- Maintain regression coverage.
- Determine release readiness.

## 6.2 Software Engineer

Needs to:

- Receive reproducible findings.
- See exact impact.
- See affected code.
- Understand root cause.
- Apply concrete fixes.
- Verify the fix.

## 6.3 Security Engineer

Needs to:

- See security findings.
- Review evidence.
- Validate severity.
- Trace runtime behavior to source code.
- Review remediation.

## 6.4 Engineering Lead

Needs:

- Executive-level visibility.
- Release-readiness status.
- Critical/high findings.
- Trend information.
- CI/CD gate decisions.

---

# 7. Core User Journey

## 7.1 Project Onboarding

User:

1. Creates a project.
2. Adds repository.
3. Adds application/API URL.
4. Selects environment.
5. Configures credentials if required.
6. Defines testing scope.
7. Starts audit.

Kase:

1. Validates configuration.
2. Validates target authorization.
3. Detects project technology.
4. Creates audit plan.
5. Starts execution.

---

# 8. Audit Modes

## 8.1 Full Audit

Runs all applicable MVP categories.

## 8.2 Smoke Audit

Runs only:

- Reconnaissance.
- Critical functional flows.
- Authentication/authorization.
- Basic security checks.
- Dependency/security scan.
- Critical accessibility.
- Critical regression checks.

## 8.3 Security Audit

Runs:

- Reconnaissance.
- Headers/TLS.
- Authentication.
- Authorization.
- API security.
- Secrets.
- Dependencies.
- Static security analysis.

## 8.4 Regression Audit

Runs:

- Existing automated tests.
- Previously failed tests.
- Tests associated with changed code.
- Critical paths.

---

# 9. MVP Architecture

```text id="8w5q9s"
                         ┌──────────────────────┐
                         │       QA FORGE       │
                         │       WEB/API        │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   AUDIT ORCHESTRATOR  │
                         └──────────┬───────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
       ┌────────▼────────┐                   ┌─────────▼────────┐
       │  BLACK BOX      │                   │    WHITE BOX     │
       │  QA SKILL       │                   │    QA SKILL      │
       └────────┬────────┘                   └─────────┬────────┘
                │                                      │
                └─────────────────┬────────────────────┘
                                  │
                        ┌─────────▼──────────┐
                        │   TOOL ADAPTERS    │
                        └─────────┬──────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  ↓               ↓                ↓
             Playwright         curl            Semgrep
                  ↓               ↓                ↓
                axe          Lighthouse      npm/pip audit
                  ↓               ↓                ↓
                  └───────────────┬────────────────┘
                                  ↓
                         ┌───────────────────┐
                         │   EVIDENCE STORE  │
                         └─────────┬─────────┘
                                   ↓
                         ┌───────────────────┐
                         │ FINDING ENGINE    │
                         └─────────┬─────────┘
                                   ↓
                      ┌────────────────────────┐
                      │ EVIDENCE CORRELATOR    │
                      └───────────┬────────────┘
                                  ↓
                        ┌────────────────────┐
                        │   AI REVIEW LAYER  │
                        └───────────┬────────┘
                                    ↓
                   ┌────────────────┼────────────────┐
                   ↓                ↓                ↓
                Reports           Jira          GitHub
                   │                │                │
                   └────────────────┼────────────────┘
                                    ↓
                           ┌───────────────────┐
                           │   RELEASE GATE    │
                           └───────────────────┘
```

---

# 10. Functional Requirements

# FR-001 — Project Management

The system shall allow users to create and manage projects.

### Required fields

- Project name.
- Description.
- Repository URL.
- Target URL.
- Environment.
- Default branch.
- Technology metadata.
- Configuration.

### Acceptance criteria

- A project can be created.
- A project can be edited.
- A project can be archived.
- A project contains both repository and application target information.
- Audit history belongs to a project.

---

# FR-002 — Repository Connection

Kase shall support repository ingestion.

### MVP support

- GitHub HTTPS repositories.
- Public repositories.
- Authenticated repositories through a secure token mechanism.

### Requirements

- Clone repository.
- Record commit SHA.
- Detect branch.
- Detect language.
- Detect framework.
- Detect package manager.
- Detect test framework.

### Acceptance criteria

A repository can be successfully cloned into an isolated audit workspace and its commit SHA is recorded.

---

# FR-003 — Application Target Configuration

Users shall be able to configure:

- Target URL.
- API base URL.
- Environment.
- Test accounts.
- Optional API credentials.
- Allowed domains.
- Excluded paths.

The system shall distinguish between:

- Production.
- Staging.
- Development.
- Unknown.

---

# FR-004 — Scope and Safety Controls

Kase shall enforce safe testing defaults.

### Requirements

- Non-destructive testing by default.
- Target allowlist.
- Rate limits.
- Concurrency limits.
- Request budgets.
- Destructive-test disabled by default.
- Load testing disabled against production by default.
- Audit cancellation.
- Worker timeout.
- Credential isolation.
- Sensitive-value redaction.

### Acceptance criteria

The system cannot accidentally launch unrestricted load testing against an unapproved production target.

---

# FR-005 — Audit Creation

User shall be able to create an audit with:

- Project.
- Audit type.
- Scope.
- Environment.
- Tools.
- Black Box enabled/disabled.
- White Box enabled/disabled.

Audit status must include:

```text id="f7v1c2"
QUEUED
INITIALIZING
DISCOVERING
RUNNING
ANALYZING
CORRELATING
REPORTING
COMPLETED
FAILED
CANCELLED
TIMED_OUT
```

---

# FR-006 — Audit Planner

Kase shall generate an execution plan before running tests.

The plan shall consider:

- Target type.
- Project technology.
- Audit mode.
- Enabled tools.
- Available credentials.
- Environment.
- Scope.

Example:

```text id="z0t0e5"
Recon
 ↓
Technology Detection
 ↓
Black Box Audit
 ├─ Auth
 ├─ Security
 ├─ API
 ├─ Accessibility
 └─ Functional
 ↓
White Box Audit
 ├─ Static Security
 ├─ Secrets
 ├─ Dependencies
 ├─ Auth Logic
 └─ Coverage
 ↓
Evidence Processing
 ↓
Finding Correlation
 ↓
Report
 ↓
Release Gate
```

---

# FR-007 — Black Box Skill Integration

Kase shall integrate the existing `qa-audit` skill as the Black Box reasoning module.

The skill's existing methodology shall remain authoritative for:

- Scope.
- Reconnaissance.
- Category selection.
- Evidence collection.
- Finding structure.
- Severity reasoning.
- Reporting behavior.

The Black Box skill currently defines a broad audit covering areas including security, authentication/authorization, API surface, performance, accessibility, SEO, UX/cross-platform, observability, functional edge cases, network resilience, and load testing.

### MVP external capabilities

- HTTP/API probing.
- Playwright browser execution.
- Accessibility via axe.
- Lighthouse.
- Basic performance checks.

---

# FR-008 — White Box Skill Integration

Kase shall integrate the existing `qa-audit-whitebox` skill as the White Box reasoning module.

The White Box module shall retain its source-grounded methodology.

### MVP categories

- Code map.
- Static security analysis.
- Secrets/configuration.
- Dependencies.
- Authentication/authorization.
- Input validation/error handling.
- Code quality.
- Test coverage.
- Infrastructure-as-code where present.

The existing White Box methodology explicitly examines issues such as injection, XSS, path traversal, SSRF, secrets, dependency vulnerabilities, authentication/authorization logic, validation, error handling, code quality, coverage and infrastructure security.

---

# FR-009 — Tool Adapter Framework

Kase shall expose a common interface for all tools.

```text id="y7n19q"
ToolAdapter
 ├─ metadata()
 ├─ validate()
 ├─ prepare()
 ├─ execute()
 ├─ collectEvidence()
 ├─ normalizeResult()
 └─ cleanup()
```

Each adapter shall:

- Declare capabilities.
- Validate prerequisites.
- Execute within a controlled worker.
- Capture raw output.
- Normalize output.
- Handle tool failure independently of product failure.

---

# FR-010 — Playwright Adapter

MVP requirements:

- Chromium.
- Firefox.
- WebKit where environment allows.
- Authenticated sessions.
- Screenshots.
- Trace capture.
- Console logs.
- Network logs.
- Test output.

The adapter shall expose execution results to the Black Box skill.

---

# FR-011 — HTTP/API Adapter

The HTTP adapter shall support:

- GET.
- POST.
- PUT.
- PATCH.
- DELETE.
- Headers.
- Query parameters.
- JSON bodies.
- Authentication.
- Response inspection.

It shall capture:

- Request.
- Response.
- Status code.
- Headers.
- Response time.
- Error details.

---

# FR-012 — Accessibility Adapter

Use axe-core where available.

The adapter shall produce:

- Rule ID.
- Severity/impact.
- Affected element.
- Selector.
- Description.
- Remediation.
- Raw output.

---

# FR-013 — Performance Adapter

MVP shall support Lighthouse.

Capture:

- Performance metrics.
- Core Web Vitals.
- Accessibility.
- Best practices.
- SEO.
- Raw report.

---

# FR-014 — White Box Static Analysis

MVP shall support:

- Semgrep.
- npm audit for Node projects.
- pip-audit for Python projects.
- Project-native linters where present.
- Project-native type checking where present.

Tool execution must preserve raw results.

---

# FR-015 — Evidence Store

Every audit must produce immutable evidence artifacts.

### Supported evidence

- Screenshots.
- Browser traces.
- HTTP request/response.
- Console output.
- Network logs.
- Lighthouse JSON.
- axe output.
- Semgrep output.
- Dependency scan output.
- Test output.
- Source-code references.
- Git metadata.

### Evidence schema

```text id="xj3p8n"
Evidence
 ├─ id
 ├─ auditId
 ├─ tool
 ├─ type
 ├─ timestamp
 ├─ environment
 ├─ artifactPath
 ├─ hash
 └─ metadata
```

---

# FR-016 — Finding Schema

All findings shall use a common schema.

```text id="ce3s3w"
Finding
 ├─ ID
 ├─ Title
 ├─ Severity
 ├─ Category
 ├─ Affected Target
 ├─ Description
 ├─ Reproduction
 ├─ Impact
 ├─ Root Cause
 ├─ Fix
 ├─ Confidence
 ├─ Evidence[]
 ├─ SourceLocation
 ├─ Status
 ├─ FirstSeen
 └─ LastSeen
```

For security findings, CWE shall be included where applicable.

The Black Box skill's finding format specifically requires ID, title, severity, affected target, reproduction, impact and concrete remediation; passing checks are also intended to be logged.

---

# FR-017 — Severity Engine

Severity levels:

| Severity | MVP Meaning |
|---|---|
| Critical | Release-blocking and severe security, integrity, availability, or core-function issue |
| High | Major exploitable or business-impacting issue |
| Medium | Significant but non-critical defect or risk |
| Low | Minor issue with limited impact |
| Informational | Observation or improvement |

The severity system shall be centralized rather than generated independently by each tool.

---

# FR-018 — Finding Deduplication

Kase shall detect duplicate findings generated by multiple sources.

Examples:

```text id="9es0hg"
Semgrep finding
+
White Box AI finding
+
Manual code observation
=
ONE normalized finding
```

Deduplication factors may include:

- Same source location.
- Same endpoint.
- Same CWE.
- Same root cause.
- Similar fingerprint.
- Same evidence.

---

# FR-019 — Evidence Correlation

This is a defining MVP capability.

Kase shall attempt to link:

**Black Box finding → API endpoint → backend route → source location → White Box finding**

Example:

```text id="ll40q2"
Black Box:
GET /api/invoices/123
returns another user's invoice
            ↓
Correlation
            ↓
White Box:
invoiceController.ts:84
resource lookup lacks ownership condition
            ↓
Correlated Finding
```

The system shall preserve both pieces of evidence.

---

# FR-020 — AI Finding Review

An AI review layer shall:

- Review normalized findings.
- Check for duplicate findings.
- Validate evidence completeness.
- Improve reproduction clarity.
- Summarize impact.
- Identify likely root cause.
- Recommend remediation.
- Assign confidence.
- Flag findings requiring human verification.

AI output must not silently overwrite raw evidence.

---

# FR-021 — Report Generation

Kase shall generate:

1. Executive Summary.
2. Full Audit Report.
3. Findings by Category.
4. Evidence Index.
5. Release Readiness Result.

### Executive Summary

Must include:

- Total findings.
- Count by severity.
- Highest-risk findings.
- Scope.
- Tested categories.
- Tool coverage.
- Release recommendation.

The existing skills intentionally write the executive summary after category reports and rank the most important must-fix issues across categories; Kase shall preserve that approach. 
---

# FR-022 — GitHub Integration

MVP requirements:

- Connect repository.
- Run Kase from GitHub Actions.
- Publish audit artifacts.
- Publish pass/fail status.
- Comment summarized findings on pull requests.
- Associate audit with commit SHA.

---

# FR-023 — CI/CD Integration

The MVP shall expose a CLI and/or CI action:

```text id="3n7y1t"
qa-forge audit
qa-forge regression
qa-forge gate
```

Example workflow:

```text id="6z9hkp"
Pull Request
    ↓
Kase
    ↓
Black Box + White Box
    ↓
Findings
    ↓
Release Gate
    ↓
PASS / FAIL
```

---

# FR-024 — Release Gate

The release gate shall support configurable policies.

Default MVP policy:

```text id="3tm4p5"
FAIL if:
- Critical finding exists
OR
- High security finding exists
OR
- Critical regression test fails
OR
- Required audit category fails to execute
```

The system shall expose:

- Gate status.
- Blocking finding IDs.
- Gate policy used.
- Audit ID.
- Commit SHA.
- Timestamp.

---

# FR-025 — Jira Integration

MVP requirements:

- Connect Jira.
- Create issue from finding.
- Map severity.
- Include reproduction.
- Include impact.
- Include remediation.
- Attach evidence.
- Link audit.
- Store Jira issue ID.

Optional MVP behavior:

- Detect existing related issue.
- Avoid duplicate ticket creation.

---

# FR-026 — Audit History

Users shall be able to view:

- Previous audits.
- Audit status.
- Finding counts.
- New findings.
- Resolved findings.
- Regressions.
- Gate result.
- Commit/version reviewed.

---

# FR-027 — Finding Lifecycle

Finding lifecycle:

```text id="gy0pj4"
OPEN
  ↓
CONFIRMED
  ↓
IN PROGRESS
  ↓
FIXED
  ↓
VERIFIED

                 ↘
                  REGRESSED
```

Additional terminal state:

```text id="4qd2vr"
FALSE POSITIVE
```

---

# 11. Non-Functional Requirements

## 11.1 Security

- Credentials must never be written to ordinary logs.
- Secrets in evidence must be redacted where feasible.
- Worker execution must be isolated.
- Repository code must run inside controlled environments.
- Target allowlisting must be enforced.
- Destructive operations must require explicit authorization.
- Audit events must be logged.

## 11.2 Reliability

- Failed tool execution must not automatically fail the entire audit.
- Jobs must be retryable.
- Audits must be resumable where practical.
- Partial results must be preserved.
- Worker timeouts must exist.

## 11.3 Performance

The MVP should support:

- Multiple tool jobs running concurrently.
- At least one audit executing while another is queued.
- Progress updates without polling the external tools directly.
- Streaming/logging of worker status.

## 11.4 Observability

Capture:

- Audit duration.
- Job duration.
- Tool failures.
- Agent failures.
- Number of findings.
- LLM usage.
- Worker status.
- Queue depth.

---

# 12. Data Model

Core entities:

```text id="q3d3e7"
User
Project
Repository
Target
Audit
AuditJob
ToolExecution
Evidence
Finding
FindingEvidence
FindingRelation
TestCase
TestExecution
Report
ReleaseGate
Integration
JiraIssue
```

Relationships:

```text id="z6d8b9"
Project
 ├── Repository
 ├── Target
 ├── Audits
 │    ├── Jobs
 │    ├── ToolExecutions
 │    ├── Evidence
 │    ├── Findings
 │    └── Reports
 └── Integrations
```

---

# 13. API Requirements

## POST /projects

Create project.

## GET /projects

List projects.

## GET /projects/:id

Get project.

## POST /projects/:id/audits

Start an audit.

## GET /audits/:id

Get audit status.

## POST /audits/:id/cancel

Cancel audit.

## GET /audits/:id/findings

List findings.

## GET /findings/:id

Get finding detail.

## POST /findings/:id/jira

Create Jira issue.

## GET /audits/:id/report

Retrieve generated report.

## POST /audits/:id/gate

Evaluate release gate.

---

# 14. CLI Requirements

QA engineers should be able to run Kase without the dashboard.

### Start audit

```bash
qa-forge audit \
  --project my-app \
  --url https://staging.example.com \
  --repo https://github.com/org/repo
```

### Run specific mode

```bash
qa-forge audit \
  --project my-app \
  --mode security
```

### Run regression

```bash
qa-forge regression \
  --project my-app
```

### Evaluate release gate

```bash
qa-forge gate \
  --audit <audit-id>
```

---

# 15. Dashboard Requirements

The MVP dashboard should have four primary pages.

## 15.1 Projects

Show:

- Project name.
- Environment.
- Repository.
- Target.
- Latest audit.
- Release status.

## 15.2 Audit

Show:

- Current status.
- Progress.
- Running tools.
- Findings.
- Failed tools.
- Evidence count.

## 15.3 Findings

Show:

- Severity.
- Title.
- Category.
- Status.
- Confidence.
- Black/White Box source.
- Jira state.

## 15.4 Finding Detail

Show:

- Description.
- Severity.
- Reproduction.
- Impact.
- Root cause.
- Fix.
- Evidence.
- Source location.
- Related findings.
- Jira issue.
- Audit history.

---

# 16. AI Architecture

The MVP should use an abstract model-provider interface.

```text id="2hn3pl"
AIProvider
 ├── analyze()
 ├── summarize()
 ├── correlate()
 ├── reviewFinding()
 └── generateReport()
```

The product should not depend on one model provider at the domain layer.

The agent should receive:

- Project context.
- Audit scope.
- Tool outputs.
- Raw evidence references.
- Existing findings.
- Source-code references.
- Previous audit history where applicable.

The model should not be given unrestricted direct access to production infrastructure.

---

# 17. Tool Execution Security Model

Every tool invocation should run through a controlled executor.

```text id="c7y9rb"
AI Agent
   ↓
Tool Request
   ↓
Policy Validator
   ↓
Scope Validator
   ↓
Resource Limits
   ↓
Sandboxed Worker
   ↓
Tool
   ↓
Raw Evidence
   ↓
Evidence Store
```

The AI agent should **request capabilities**, not directly execute arbitrary shell commands.

---

# 18. MVP Release Gate Policy

### Default blocking conditions

| Condition | Result |
|---|---|
| Critical finding | FAIL |
| High security finding | FAIL |
| Critical regression failure | FAIL |
| Required audit job failed | FAIL |
| Audit incomplete | FAIL |
| Only Medium/Low findings | PASS with warnings |
| No findings | PASS |

The policy must be configurable by project.

---

# 19. Acceptance Criteria

The MVP is considered functional when the following complete flow works:

### Scenario A — Web application audit

1. User creates project.
2. User supplies repository.
3. User supplies staging URL.
4. User starts Full Audit.
5. Kase discovers stack.
6. Black Box skill runs.
7. White Box skill runs.
8. Playwright executes.
9. HTTP adapter executes.
10. Static analysis executes.
11. Dependency audit executes.
12. Evidence is persisted.
13. Findings are normalized.
14. Duplicate findings are merged.
15. Black-box and white-box findings are correlated where possible.
16. Executive summary is generated.
17. Full report is generated.
18. Findings appear in dashboard.
19. User creates a Jira issue from a finding.
20. GitHub receives audit status.
21. Release gate evaluates the audit.
22. CI receives PASS or FAIL.

### Scenario B — Confirming a fix

1. Audit produces finding `SEC-001`.
2. Finding is linked to Jira.
3. Developer fixes the issue.
4. New commit triggers Kase.
5. Relevant regression is run.
6. Finding is re-evaluated.
7. Finding becomes `FIXED`/`VERIFIED`.
8. Release gate changes accordingly.

### Scenario C — Regression

1. Previously fixed finding exists.
2. New deployment reintroduces the defect.
3. Kase reproduces it.
4. Finding status becomes `REGRESSED`.
5. Jira issue is reopened or linked.
6. Release gate blocks deployment.

---

# 20. MVP Success Metrics

### Quality

- ≥90% of Critical/High findings include reproducible evidence.
- ≥90% of actionable findings contain concrete remediation.
- ≥95% of generated finding records conform to schema.
- Duplicate findings from different tools are deduplicated.

### Execution

- Audit can survive individual tool failures.
- Every tool invocation produces a persisted execution record.
- Every audit has a final status.

### Release assurance

- Release gate produces deterministic results from configured policy.
- Failed releases identify the exact blocking findings.
- Fixed findings can be re-verified.

### User experience

- A new project can start its first audit without manually configuring every individual tool.
- Audit progress is visible.
- Findings are understandable without reading raw tool output.

---

# 21. MVP Backlog

## Epic 1 — Foundation

- [ ] Repository setup.
- [ ] Database.
- [ ] Core domain models.
- [ ] Authentication.
- [ ] Configuration system.
- [ ] Logging.
- [ ] Error handling.
- [ ] CI for Kase itself.

## Epic 2 — Audit Engine

- [ ] Project onboarding.
- [ ] Repository ingestion.
- [ ] Target configuration.
- [ ] Scope configuration.
- [ ] Audit lifecycle.
- [ ] Planner.
- [ ] Job queue.
- [ ] Worker system.

## Epic 3 — Skill Integration

- [ ] Black Box skill adapter.
- [ ] White Box skill adapter.
- [ ] Context injection.
- [ ] Tool access layer.
- [ ] Evidence access layer.

## Epic 4 — Tool Adapters

- [ ] Playwright.
- [ ] HTTP/curl.
- [ ] axe.
- [ ] Lighthouse.
- [ ] Semgrep.
- [ ] npm audit.
- [ ] pip-audit.
- [ ] Native test runner.

## Epic 5 — Evidence

- [ ] Artifact storage.
- [ ] Evidence metadata.
- [ ] Hashing.
- [ ] Redaction.
- [ ] Evidence retrieval API.
- [ ] Evidence viewer.

## Epic 6 — Finding Intelligence

- [ ] Finding schema.
- [ ] Severity engine.
- [ ] Confidence.
- [ ] Deduplication.
- [ ] Correlation.
- [ ] Finding lifecycle.

## Epic 7 — Reporting

- [ ] Executive summary.
- [ ] Technical report.
- [ ] Findings by category.
- [ ] Evidence index.
- [ ] JSON output.
- [ ] HTML output.

## Epic 8 — CI/CD

- [ ] CLI.
- [ ] GitHub Action.
- [ ] PR status.
- [ ] Artifact publishing.
- [ ] Release gate.

## Epic 9 — Jira

- [ ] Authentication.
- [ ] Create issue.
- [ ] Attach evidence.
- [ ] Link finding.
- [ ] Detect duplicates.

## Epic 10 — Dashboard

- [ ] Projects.
- [ ] Audit progress.
- [ ] Findings.
- [ ] Finding detail.
- [ ] Release status.

---

# 22. Recommended Technical Architecture

The MVP should be modular enough to evolve into a larger platform.

```text id="n4t8u5"
                    ┌─────────────────┐
                    │   Web Frontend  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │     API Layer   │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
    │ Audit     │      │ Findings   │      │ Integration│
    │ Service   │      │ Service    │      │ Service    │
    └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Job Queue/Worker│
                    └────────┬────────┘
                             │
               ┌─────────────┼─────────────┐
               │             │             │
        ┌──────▼─────┐ ┌─────▼─────┐ ┌────▼────┐
        │ Black Box  │ │ White Box  │ │Adapters │
        │ Skill      │ │ Skill      │ │          │
        └────────────┘ └────────────┘ └──────────┘
               │             │             │
               └─────────────┼─────────────┘
                             ↓
                     Evidence Store
                             ↓
                    Correlation Engine
                             ↓
                         AI Layer
                             ↓
                      Report / Gate
```

---

# 23. MVP Priorities

The order of implementation must be:

### P0 — Absolutely Required

- Audit orchestration.
- Black Box skill integration.
- White Box skill integration.
- Tool adapters.
- Evidence store.
- Finding schema.
- Finding normalization.
- Basic correlation.
- Reports.
- CLI.
- GitHub Actions.
- Release gate.

### P1 — Required for a good MVP

- Jira integration.
- Dashboard.
- Finding lifecycle.
- Audit history.
- Confidence scoring.
- Deduplication.
- Accessibility/performance integrations.

### P2 — Immediately Post-MVP

- BrowserStack integration.
- Self-healing.
- Visual regression.
- Intelligent test selection.
- Advanced regression management.
- More CI systems.

---

# 24. What Kase MVP Should NOT Become

Avoid turning the MVP into:

> “A dashboard that runs 20 testing tools.”

That would make Kase just another test aggregation platform.

The product differentiation is:

```text id="b3kjq3"
TOOLS
  ↓
RAW EVIDENCE
  ↓
BLACK BOX REASONING
+
WHITE BOX REASONING
  ↓
CORRELATION
  ↓
ROOT CAUSE
  ↓
ACTIONABLE FINDING
  ↓
REGRESSION
  ↓
RELEASE DECISION
```

The **reasoning and correlation layer** is the product.

The tools are capabilities Kase orchestrates.

---

# 25. MVP Definition of Done

Kase MVP is complete when a real project can go through this lifecycle without manual intervention between major stages:

```text id="pxv2qk"
                    PROJECT
                       ↓
                 TARGET + REPO
                       ↓
                 SCOPE VALIDATION
                       ↓
                 AUDIT PLANNING
                       ↓
          ┌────────────┴────────────┐
          ↓                         ↓
     BLACK BOX                 WHITE BOX
          ↓                         ↓
      TOOL RUNS                  TOOL RUNS
          ↓                         ↓
          └────────────┬────────────┘
                       ↓
                 EVIDENCE STORE
                       ↓
                 FINDING ENGINE
                       ↓
              DEDUPLICATION
                       ↓
               CORRELATION
                       ↓
                 AI REVIEW
                       ↓
                 QA REPORT
                       ↓
             ┌─────────┴─────────┐
             ↓                   ↓
           JIRA              GITHUB/CI
                                 ↓
                           RELEASE GATE
                                 ↓
                          PASS / FAIL
```

A successful MVP therefore proves the central Kase thesis:

> **A running system and its source code can be audited together, with evidence from both sides correlated into actionable findings and converted into an automated release decision.**

That is the foundation on which the later **self-healing, browser/device scale, test management, enterprise governance, and AI/agent QA** layers should be built.