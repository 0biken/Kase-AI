# Kase

**AI QA audit platform.** Kase audits a running system and its source code together, correlates evidence from both sides into actionable findings, and converts the result into an automated release decision.

> **Design principle:** AI is the reasoning layer, not the system of record.
> The system of record is PostgreSQL + the evidence store + deterministic execution records + the validated Finding schema + the policy engine.
> The two QA skills are the brains. The deterministic platform is the body. The correlation engine is the nervous system.

---

## What makes Kase different

Kase is not a dashboard that runs twenty testing tools. Tool aggregation is a commodity. The product is the layer above it:

```
TOOLS → RAW EVIDENCE → BLACK BOX REASONING + WHITE BOX REASONING
      → CORRELATION → ROOT CAUSE → ACTIONABLE FINDING
      → REGRESSION → RELEASE DECISION
```

The defining capability is **correlation**: linking an externally observed defect to the exact source location that causes it.

```
Black box:  GET /api/invoices/123 returns another user's invoice
                              ↓
Correlation (route map + build provenance)
                              ↓
White box:  src/invoices/invoice.controller.ts → findOne()
            resource lookup lacks ownership predicate
                              ↓
            One correlated finding, both artifacts preserved
```

---

## Documentation index

| # | Section | Contents |
|---|---|---|
| 00 | [Overview](docs/00-overview/README.md) | Product definition, users, scope, non-goals |
| 01 | [Architecture](docs/01-architecture/README.md) | System architecture, pipeline ordering, data flow |
| 02 | [Technology Stack](docs/02-stack/README.md) | Stack decisions, rationale, licensing, polyglot workers |
| 03 | [Data Model](docs/03-data-model/README.md) | Entities, relationships, schema definitions |
| 04 | [Audit Orchestrator](docs/04-orchestrator/README.md) | Audit lifecycle, job graph, state machine, resumability |
| 05 | [Agent Runtime](docs/05-agent-runtime/README.md) | Skill-to-platform bridge, tool contract, determinism |
| 06 | [Recon & Endpoint Inventory](docs/06-recon/README.md) | Crawling, discovery, the black-box↔white-box join key |
| 07 | [Tool Adapters](docs/07-tool-adapters/README.md) | Adapter interface, per-tool specs, failure isolation |
| 08 | [Evidence Store](docs/08-evidence/README.md) | Immutable artifacts, hashing, redaction, replay |
| 09 | [Finding Engine](docs/09-findings/README.md) | Normalization, severity, fingerprinting, dedup, lifecycle |
| 10 | [Correlation Engine](docs/10-correlation/README.md) | Build provenance, route mapping, the four layers |
| 11 | [AI Layer](docs/11-ai-layer/README.md) | Provider abstraction, context strategy, cost budgets |
| 12 | [Policy Engine & Release Gate](docs/12-policy-gate/README.md) | Evidence-class gating, waivers, fail-closed rules |
| 13 | [Integrations](docs/13-integrations/README.md) | GitHub, GitHub Actions, Jira |
| 14 | [REST API](docs/14-api/README.md) | Endpoints, auth, pagination, errors |
| 15 | [CLI](docs/15-cli/README.md) | Commands, exit codes, CI usage |
| 16 | [Web Dashboard](docs/16-web/README.md) | Screens, information architecture |
| 17 | [Security Model](docs/17-security/README.md) | Threat model, sandboxing, scope validation, authorization |
| 18 | [Observability](docs/18-observability/README.md) | Metrics, traces, logs, audit trail |
| 19 | [Roadmap](docs/19-roadmap/README.md) | Vertical slice, milestones, priorities, cut list |
| 20 | [Decision Records](docs/20-adr/README.md) | ADR index and rationale |

---

## Proof of the thesis

The correlation path is not just specified — it runs. [`spike/correlation/`](spike/correlation/README.md) proves the full chain end to end against a seeded IDOR, with no platform around it:

```
GET /api/invoices/{id}  ->  InvoiceController.findOne  ->  InvoiceService.find
```

```bash
cd spike/correlation && npm install && npm run spike
```

One correlated finding, both evidence artifacts preserved, gate blocks the build. `npm run spike:unverified` proves the provenance safety property; `npm run spike:fixed` proves the finding clears on remediation.

---

## Delivery

[TASKS.md](TASKS.md) is the executable checklist — 130 tasks across Phase 0 and M1–M7, with milestone exit criteria as the real gates. Start with Phase 0; the Semgrep licensing review has the longest lead time and blocks M2.

For substantial engineering work, [`quality-gates/`](quality-gates/README.md) provides executable completion ledgers backed by a project-local, commit-pinned copy of Unlazy. This verifies development claims only; it is deliberately separate from Kase's product policy engine and never runs in audit workers.

---

## Development Setup

The platform uses a `pnpm` monorepo structure with Docker Compose for local infrastructure.

```bash
# 1. Start Postgres, Redis, MinIO, and the test fixture target
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Generate the Prisma client
pnpm --filter @kase/db run build

# 4. Start the NestJS API
pnpm dev
```

The original product-definition draft — goals, users, scope, FRs — lives at [Kase MVP — Product Requirements Document.md](Kase%20MVP%20—%20Product%20Requirements%20Document.md). It carries a status banner pointing back here: this `docs/` tree is the current source of truth for technical design, and [20 — Decision Records](docs/20-adr/README.md) lists every place the two diverge and why.

---

## Source assets

Kase is built around two existing Claude Agent Skills, packaged in this repository:

| Asset | Role |
|---|---|
| `qa-audit.skill` | Black-box methodology — 15 test categories, recon-first, fix-included findings |
| `qa-audit-whitebox.skill` | White-box methodology — 10 categories, `file:line` grounded, patch-included findings |

Their `references/` payloads (`test-categories.md`, `whitebox-categories.md`, `finding-format*.md`, `report-structure*.md`) are consumed **verbatim** as agent methodology. Their `SKILL.md` orchestration steps are **replaced** by the Kase agent runtime — see [05 — Agent Runtime](docs/05-agent-runtime/README.md#2-relationship-to-the-packaged-skills).

---

## Status

M1 is implemented and verified by both static checks and a live Docker Compose proof. The retained stack demonstrates live PostgreSQL migrations, API audit dispatch, correctly hashed MinIO evidence, fail-closed denied egress, and a non-root agent worker isolated from the target. M2 — the deterministic audit spine — is next; see [19 — Roadmap](docs/19-roadmap/README.md#3-milestones).
