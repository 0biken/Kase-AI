# Kase — Technical Documentation

The single source of truth for Kase's technical design. The [PRD](../Kase%20MVP%20%E2%80%94%20Product%20Requirements%20Document.md) defines the product; where the two disagree, this tree wins, and [20 — ADR](20-adr/README.md) records why.

---

## Reading order

New to the project, read these four in order — they carry the thesis:

1. [00 — Overview](00-overview/README.md) — what Kase is, and what it must not become
2. [01 — Architecture](01-architecture/README.md) — the pipeline and how the pieces fit
3. [10 — Correlation Engine](10-correlation/README.md) — the load-bearing idea: black-box defect → exact source symbol
4. [20 — ADR](20-adr/README.md) — every decision that changed the design, with what was rejected

The correlation thesis is proven end to end by two runnable spikes: [`spike/correlation/`](../spike/correlation/README.md) (NestJS) and [`spike/correlation-fastapi/`](../spike/correlation-fastapi/README.md) (FastAPI).

## All sections

### Foundations
| | |
|---|---|
| [00 — Overview](00-overview/README.md) | Product definition, users, scope, non-goals |
| [01 — Architecture](01-architecture/README.md) | System architecture and the audit pipeline |
| [02 — Technology Stack](02-stack/README.md) | Stack decisions, secrets, concurrency, naming |
| [03 — Data Model](03-data-model/README.md) | Entities, schemas, indexing, retention |

### The pipeline
| | |
|---|---|
| [04 — Audit Orchestrator](04-orchestrator/README.md) | Job graph, budgets, resumability |
| [05 — Agent Runtime](05-agent-runtime/README.md) | Capability-shaped tools, agent isolation |
| [06 — Recon & Endpoint Inventory](06-recon/README.md) | Discovery, and why every URL re-enters the scope validator |
| [07 — Tool Adapters](07-tool-adapters/README.md) | The adapter interface and per-tool specs |
| [08 — Evidence Store](08-evidence/README.md) | Content-addressed storage, redaction, retention |
| [09 — Finding Engine](09-findings/README.md) | Fingerprints, severity, lifecycle, gate eligibility |
| [10 — Correlation Engine](10-correlation/README.md) | Route map, code map, and the join |
| [11 — AI Layer](11-ai-layer/README.md) | Where AI proposes, and where it is not trusted |
| [12 — Policy Engine & Release Gate](12-policy-gate/README.md) | Evidence-class gating, waivers, fail-closed |

### Surfaces
| | |
|---|---|
| [13 — Integrations](13-integrations/README.md) | GitHub App, GitHub Actions, Jira |
| [14 — REST API](14-api/README.md) | Endpoints, auth, conventions |
| [15 — CLI](15-cli/README.md) | Commands and exit codes |
| [16 — Web Dashboard](16-web/README.md) | Screens, display rules, real-time |

### Operations and direction
| | |
|---|---|
| [17 — Security Model](17-security/README.md) | Threat model, scope validation, multi-tenancy, audit trail |
| [18 — Observability](18-observability/README.md) | Metrics, tracing, logging |
| [19 — Roadmap](19-roadmap/README.md) | Milestones, risks, cut list |
| [20 — ADR](20-adr/README.md) | Architecture decision records |

## The four ideas worth knowing

**Correlation is the product.** Linking an externally observed defect to the exact source symbol that causes it — not running twenty tools and rendering a dashboard ([00 §7](00-overview/README.md)).

**Only replayable evidence may block.** Gating on an AI confidence score was rejected; a block must come with a request an engineer can re-run themselves ([ADR-002](20-adr/README.md), [12 §3](12-policy-gate/README.md#3-evidence-class-gating)).

**Provenance makes correlation trustworthy.** If the running deployment cannot be bound to the audited commit, correlations are recorded unverified and cannot block ([ADR-003](20-adr/README.md)).

**Degraded is not passing.** A partial or degraded audit has its own outcome and can never produce PASS ([ADR-007](20-adr/README.md), [12 §7](12-policy-gate/README.md#7-fail-closed)).

## Delivery status

[`TASKS.md`](../TASKS.md) tracks execution against [19 — Roadmap](19-roadmap/README.md).
