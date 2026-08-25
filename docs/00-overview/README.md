# 00 — Overview

Product definition, users, scope boundaries.

---

## 1. What Kase is

Kase is an AI-powered QA and release-assurance platform. It runs two complementary audits against the same release candidate:

- **Black-box audit** — probes a live deployment from the outside (recon, security, authn/authz, API surface, performance, accessibility, resilience, load).
- **White-box audit** — reads the source at a known commit (static security, secrets, dependency CVEs, authz logic, input validation, code quality, test coverage, IaC).

It then correlates the two into single findings carrying both an external reproduction and an exact source location, and converts the result into a deterministic release decision.

## 2. The thesis

> A running system and its source code can be audited together, with evidence from both sides correlated into actionable findings and converted into an automated release decision.

Everything in this documentation exists to make that sentence true, and trustworthy enough to sit in a CI pipeline.

## 3. What a finding must contain

Inherited from both skills. Non-negotiable.

| Part | Requirement |
|---|---|
| Severity | From the centralized severity engine, never tool-assigned |
| Location | External target **and** source location wherever correlation succeeded |
| Reproduction | Replayable, not prose |
| Impact | What it costs the business |
| Fix | Concrete — a diff, a config block, a named policy. Not "improve validation" |
| Evidence | Immutable artifacts, hashed, retained |

*A severity label with no fix is half a finding.*

## 4. Target users

| User | Primary need | Primary surface |
|---|---|---|
| QA Engineer | Coverage, evidence, regression tracking | Web dashboard |
| Software Engineer | `file:line` plus a patch, low false-positive rate | PR comment, Jira issue |
| Security Engineer | CWE mapping, exploitability, authz depth | Findings view, report |
| Engineering Lead | Release readiness in one number, waiver control | Gate status, exec summary |

## 5. Audit modes

| Mode | Scope | Typical runtime | Gate-eligible |
|---|---|---|---|
| `full` | All in-scope categories, both agents | 20–90 min | Yes |
| `smoke` | Recon + critical-path functional + deterministic scanners | 3–8 min | Yes |
| `security` | Security, authn/authz, secrets, dependencies, SAST | 10–30 min | Yes |
| `regression` | Re-verify prior findings only | 2–10 min | Yes |

Regression mode does not discover new findings. It replays stored reproductions against the new build and transitions finding state.

## 6. Non-goals for v1

Explicitly out of scope. Each is deferred, not rejected.

- Browser and device farms (BrowserStack, Sauce Labs)
- Self-healing test maintenance
- Visual regression
- Native mobile automation
- Test-case management as a product surface
- Multi-tenant enterprise governance (SSO, SCIM, org hierarchy)
- Intelligent test selection
- CI systems other than GitHub Actions

## 7. What Kase must not become

> "A dashboard that runs twenty testing tools."

Test aggregation is commodity. If the correlation engine, the finding schema, and the policy engine are not the centre of gravity, Kase has no differentiation. Every scope decision in this documentation is measured against that.

## 8. Definition of done for v1

A real project completes this lifecycle with no manual intervention between stages:

```
PROJECT
   -> TARGET + REPO + COMMIT SHA
   -> SCOPE VALIDATION
   -> AUDIT PLANNING
   -> RECON / ENDPOINT INVENTORY
   -> BLACK BOX + WHITE BOX
   -> EVIDENCE STORE
   -> FINDING NORMALIZER
   -> CORRELATION
   -> DEDUP
   -> AI REVIEW
   -> REPORT
   -> JIRA / GITHUB
   -> POLICY ENGINE
   -> RELEASE GATE -> PASS / FAIL / PARTIAL
```

---

**Next:** [01 — Architecture](../01-architecture/README.md)
