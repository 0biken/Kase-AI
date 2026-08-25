# 05 — Agent Runtime

The skill-to-platform bridge. Where the two QA skills become agents operating against a validated API.

---

## 1. The design principle

> **The AI proposes. Kase validates.**

The agent reasons freely about *what to test and what it means*. It does not decide what gets persisted. Every output crosses a typed contract and is schema-validated before it reaches the system of record.

Instead of the agent emitting prose:

```
I found a critical authorization issue in the invoices endpoint...
```

it calls:

```json
{
  "tool": "create_finding",
  "arguments": {
    "category": "authorization",
    "severity_proposed": "critical",
    "title": "IDOR allows invoice access across users",
    "reproduction": {
      "kind": "http_replay",
      "evidence_id": "EV-124"
    },
    "impact": "Any authenticated user can read any invoice, exposing customer billing data.",
    "remediation": "Add ownership predicate to the invoice lookup.",
    "remediation_patch": "--- a/src/invoices/invoice.service.ts\n+++ b/...",
    "evidence_ids": ["EV-124", "EV-126"],
    "source_locations": [
      { "file": "src/invoices/invoice.controller.ts", "enclosing_symbol": "InvoiceController.findOne" }
    ]
  }
}
```

Kase validates that object against the Finding schema, **recomputes severity through the severity engine** (`severity_proposed` is advisory input, never authoritative), resolves the fingerprint, and persists.

## 2. Relationship to the packaged skills

This is worth stating plainly rather than discovering during implementation.

The packaged `.skill` archives contain two kinds of content, and they have different fates:

| Content | Fate in Kase |
|---|---|
| `references/test-categories.md` | **Consumed verbatim** as black-box methodology |
| `references/whitebox-categories.md` | **Consumed verbatim** as white-box methodology |
| `references/finding-format*.md` | **Consumed verbatim** as the finding-quality standard |
| `references/report-structure*.md` | Consumed by the report generator |
| `SKILL.md` orchestration steps | **Replaced** by this runtime |

The current `SKILL.md` files instruct an interactive assistant to ask scoping questions and write markdown to an output folder. Kase runs headless, config-driven, and persists structured records. So Kase does not "host the skills" — it **rewrites the SKILL.md orchestration layer as an agent system prompt** while reusing the reference payloads as the methodology.

**Consequence to plan for:** the `.skill` artifacts are *source material*, not runtime. When the skills improve, the reference files can be re-vendored cheaply; the system prompt is a Kase-owned fork and must be maintained deliberately. Track the upstream skill version in `agent_prompt_version` on every audit so findings remain explainable.

## 3. Agent contexts

Each agent receives four read-only contexts at start.

```
AuditContext     project, mode, requested categories, prior audit summary,
                 remaining budget, scope policy (as constraints, not as a target list)

ToolContext      capabilities available to this agent, per-capability limits,
                 which tools are unavailable and why

EvidenceContext  evidence already collected this audit (ids + metadata, not payloads),
                 retrievable on demand

FindingContext   findings already created this audit, plus open findings from prior
                 audits with their fingerprints (for regression awareness)
```

Contexts carry **references, not payloads**. The agent pulls what it needs. This is what keeps the repository out of the model context — see [11 — AI Layer §4](../11-ai-layer/README.md#4-context-strategy).

## 4. The tool contract

### 4.1 Capabilities must be typed, never command-shaped

If `request_tool()` accepts anything resembling `{ "cmd": "curl ..." }`, Kase has rebuilt shell behind a JSON wrapper and the security model is defeated. Every capability is individually typed and individually validated.

```ts
// Correct — capability-shaped
run_http_probe({ url, method, headers?, body?, follow_redirects? })
run_crawl({ base_url, depth, max_pages })
run_browser_check({ url, viewport, theme, actions[] })
run_a11y_scan({ url, viewport })
run_perf_scan({ url, preset })
run_sast({ paths[], ruleset })
run_secret_scan({ paths[] })
run_dependency_scan({ manifest_path })
run_template_scan({ url, template_tags[] })   // nuclei

// Forbidden
run_tool({ cmd: string })
exec({ shell: string })
```

Each capability is executed by the Tool Runner in a sandboxed worker after passing the scope validator and rate limiter. See [07 — Tool Adapters](../07-tool-adapters/README.md).

### 4.2 Full tool surface

| Tool | Purpose | Validated against |
|---|---|---|
| `get_endpoint_inventory()` | Read the canonical endpoint list | — |
| `get_route_map()` | Read the Code Map route mappings | — |
| `get_source({ file, symbol? })` | Retrieve a source excerpt at the audit commit | Path within repo checkout |
| `search_source({ query, kind })` | Grep/symbol search | — |
| `request_tool(<typed capability>)` | Execute a tool | Capability schema, scope, rate, budget |
| `attach_evidence({ ... })` | Register an artifact | Evidence schema, size limit |
| `create_finding({ ... })` | Propose a finding | Finding schema, severity engine, fingerprint |
| `record_passing_check({ ... })` | Log a check that passed | PassingCheck schema |
| `report_blocked({ category, reason })` | Declare a category could not be executed | Enum of reasons |
| `request_scope_change({ host, reason })` | Ask to test outside the allowlist | **Always denied**, always logged |
| `mark_test({ testCaseId, result })` | Record a regression test outcome | — |
| `finish_audit({ summary })` | Terminate the agent loop | — |

### 4.3 The three tools that are easy to forget

These are not optional; downstream systems break without them.

**`record_passing_check()`** — both skills require passing checks to be logged. Without it, "tested and clean" and "never tested" are indistinguishable, and the gate cannot evaluate coverage.

**`report_blocked()`** — a tool is unavailable, the target is unreachable, a category was skipped. This is the *only* signal that lets the gate enforce *"required audit category failed to execute."* An agent that silently skips a category currently looks exactly like one that passed it. Reasons are enumerated: `tool_unavailable`, `target_unreachable`, `auth_failed`, `out_of_scope`, `budget_exhausted`, `destructive_not_authorized`.

**`request_scope_change()`** — the agent *will* discover an interesting host outside the allowlist. Giving it an explicit channel that is denied and logged is far safer than leaving it to improvise, and the log is useful signal about scope gaps.

## 5. The agent loop

```
initialize(contexts)
  |
  v
loop until finish_audit() or budget exhausted:
   |
   +-- model proposes tool call
   |
   +-- schema validation ------- fail --> structured error back to model
   |
   +-- policy + scope check ---- fail --> denial back to model (logged)
   |
   +-- budget check ------------ fail --> budget notice back to model
   |
   +-- Tool Runner executes in sandboxed worker
   |
   +-- result + new evidence ids returned to model
  |
  v
terminate: persist transcript, emit metrics
```

Validation failures are returned to the model as structured, actionable errors so it can self-correct — not as exceptions that kill the job.

## 6. Determinism

Two runs of the same audit will not produce identical findings. This is the core product risk in CI and must be managed at the system level, not just by lowering temperature.

| Mechanism | Effect |
|---|---|
| Temperature 0 where supported | Reduces, does not eliminate, variance |
| Pinned model version per project | Prevents silent behaviour change on provider updates |
| Deterministic tool results are authoritative | Semgrep/nuclei/npm-audit output is identical run to run |
| **Gate keys on fingerprints across runs, not fresh verdicts** | The important one — see below |

### Absence is not resolution

A finding present in audit N and absent in audit N+1 does **not** become `fixed`. It becomes `not_reproduced`, and the gate treats `not_reproduced` on a previously-blocking finding as still blocking until a regression check explicitly confirms the fix.

Without this rule, gate outcomes flap between runs and teams disable the gate within a week. With it, the gate is stable even though the agent is not perfectly deterministic.

## 7. Agent isolation

The agent worker has a deliberately narrow blast radius:

- **No direct target egress.** The agent cannot reach the customer's system; only Tool Runner workers can. The agent requests, the runner executes.
- **No filesystem write access** outside its scratch directory.
- **Read-only repository mount** at the audit commit.
- **LLM provider egress only**, on an explicit allowlist.

This means a prompt-injection payload embedded in a crawled page or a source file cannot cause the agent to execute arbitrary requests — the worst it can do is propose a tool call that the scope validator then rejects and logs.

### Prompt injection is an expected input

Kase deliberately feeds the model untrusted content: crawled HTML, HTTP responses, source code, dependency metadata. All of it is data.

- Tool results are wrapped in explicit data delimiters in the prompt.
- The system prompt states that content retrieved by tools is never instruction.
- Every capability is scope-validated regardless of what the model asks for, so a successful injection still cannot escape the allowlist.
- Anomalous requests (`request_scope_change`, repeated denials) are logged and surfaced in the audit trail.

---

**Next:** [06 — Recon & Endpoint Inventory](../06-recon/README.md)
