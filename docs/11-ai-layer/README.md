# 11 — AI Layer

Provider abstraction, context strategy, and cost control.

---

## 1. Provider abstraction

The domain layer must not depend on one model provider.

```ts
interface AIProvider {
  analyze(req: AnalyzeRequest): Promise<AnalyzeResult>
  summarize(req: SummarizeRequest): Promise<SummarizeResult>
  correlate(req: CorrelateRequest): Promise<CorrelateResult>
  reviewFinding(req: ReviewRequest): Promise<ReviewResult>
  generateReport(req: ReportRequest): Promise<ReportResult>
  runAgentLoop(req: AgentRequest): AsyncIterable<AgentEvent>
}
```

Implementations: Anthropic (default), OpenAI. Every request carries a `TokenBudget` handle and every response reports actual usage.

### Model pinning

The model identifier is **pinned per project**, not resolved to "latest". A provider updating its default model silently changes finding behaviour, which changes gate outcomes on unchanged code. Pinned model plus recorded `agent_prompt_version` on every audit is what makes a finding explainable six months later.

Model upgrades are an explicit, reviewed project action.

## 2. Where AI is used, and where it is not

| Stage | AI role | Authority |
|---|---|---|
| Audit planning | Propose job graph | Schema-validated; falls back to static plan |
| Black-box agent | Reason about what to test, propose findings | Proposes only |
| White-box agent | Read code, propose findings with patches | Proposes only |
| Correlation | Fallback inference when deterministic mapping fails | **Advisory; never gate-eligible** |
| Dedup Level 3 | Similarity on the ambiguous remainder | `POSSIBLE_MATCH` at most |
| Finding review | Enrich, clarify, flag for human review | Cannot overwrite evidence |
| Report | Prose assembly | Cannot alter findings |
| Severity | **None** | Severity engine is deterministic |
| Gate decision | **None** | Policy engine is deterministic |

The last two rows are the point. AI is the reasoning layer, not the system of record.

## 3. AI review layer

Runs after correlation and dedup. It may:

- validate evidence completeness (is the reproduction actually replayable?),
- improve reproduction clarity,
- summarize impact in business terms,
- identify likely root cause,
- assign a confidence band,
- flag findings requiring human verification,
- propose merges (subject to [09 §5](../09-findings/README.md#5-deduplication)).

It may **not**:

- modify or delete evidence,
- change severity (proposals go back through the severity engine),
- mark a finding resolved,
- change `gateEligible`,
- create a finding that has no evidence.

Enrichment is written to separate fields (`rootCause`, `impact`, `confidenceBand`) with `aiGenerated: true`. The raw normalized finding is retained unchanged alongside it.

## 4. Context strategy

**Do not send the repository to the model.** This is the single largest cost and quality lever.

The white-box agent works in stages, each narrowing what the next needs to see:

```
1. Code Map            structure, routes, symbols        cheap, mechanical
2. Deterministic scans semgrep, gitleaks, deps           no model involved
3. Dependency graph    what reaches what
4. Candidate selection files/symbols implicated by 1-3
5. Model context       ONLY the selected excerpts
```

| Context element | Cap |
|---|---|
| Source excerpt per file | 400 lines, symbol-centred |
| Total repository context per audit | 400 KB |
| Evidence payloads in context | References only; pulled on demand |
| Prior findings in context | Fingerprint + title + status, not full bodies |

Contexts carry **references, not payloads** ([05 §3](../05-agent-runtime/README.md#3-agent-contexts)). The agent retrieves what it needs through `get_source()` and `search_source()`, which keeps context proportional to what the audit actually touches rather than to repository size.

## 5. Cost budgets

Set before implementation, enforced by the orchestrator, visible to the agent.

### Per audit (full mode defaults)

| Budget | Default |
|---|---|
| `max_total_tokens` | 2,000,000 |
| `max_agent_calls` | 120 |
| `max_wall_minutes` | 90 |
| `max_repository_context_bytes` | 400,000 |
| `max_concurrent_agents` | 2 |

### Stage allocation

```
Full Audit
├── Planning          1 call, ~10k tokens
├── Black Box agent   45% of token budget
├── White Box agent   35%
├── Correlation       5%   (only the deterministic-miss remainder)
├── Finding review    10%
└── Report            1 call, 5%
```

### Budgets that protect the customer, not the bill

Token and call budgets protect cost. These protect the customer's system, and they are not optional once a crawler is in the stack:

| Budget | Default |
|---|---|
| `max_requests_to_target` | 5,000 |
| `max_requests_per_second` | 10 |
| `max_concurrent_connections` | 5 |

Enforced globally per target host across concurrent audits. This is the difference between an audit and an incident.

## 6. Degradation ladder

| State | Threshold | Behaviour |
|---|---|---|
| GREEN | < 50% | Normal |
| YELLOW | 50–80% | Skip optional AI enrichment; prefer deterministic tools |
| RED | > 80% | Stop discovery; complete normalization, correlation, report only |
| EXCEEDED | 100% | Terminate agents cleanly, preserve partial results |

### The trap this closes

If RED means "skip optional AI analysis," then **findings depend on budget state**, and the gate depends on findings — so a budget overrun would silently produce a green build.

Therefore: any transition to YELLOW or beyond sets `Audit.degraded = true`, which forces `Audit.status = 'partial'`, and **`partial` is a distinct gate outcome that is never PASS** ([12 §6](../12-policy-gate/README.md#6-outcomes)).

Degradation is loud: recorded in `degradationReasons`, shown in the report header, printed by the CLI, and posted in the PR comment.

## 7. Prompt-injection posture

Kase deliberately feeds the model untrusted content — crawled HTML, HTTP response bodies, source files, dependency metadata, commit messages. All of it is data.

| Control | Implementation |
|---|---|
| Data framing | Tool results wrapped in explicit data delimiters |
| System prompt | States that tool-retrieved content is never instruction |
| Capability validation | Every call scope-checked regardless of model intent |
| No target egress from agent worker | Agent cannot act directly; Tool Runner executes |
| Anomaly logging | `request_scope_change` calls and repeated denials surfaced in the audit trail |

A successful injection can at most cause a tool request that the scope validator rejects and logs. Structural containment, not prompt hygiene, is what makes this safe.

## 8. Usage accounting

Recorded per call and aggregated per audit:

```ts
AiUsage {
  auditId, stage, provider, model,
  inputTokens, outputTokens, cachedTokens,
  costUsd, latencyMs, retries, outcome
}
```

Surfaced in the audit detail view and exported as OpenTelemetry metrics ([18](../18-observability/README.md)). Cost per audit is a tracked product metric — an audit that costs more than the engineering time it saves is not a viable product.

## 9. Prompt caching

The methodology payload (the skills' `references/` files), the system prompt, and the Code Map summary are stable within an audit and across audits of the same project. They are placed in the cacheable prefix of every request. This is typically the largest single cost reduction available and should be built in from the start, not retrofitted.

---

**Next:** [12 — Policy Engine & Release Gate](../12-policy-gate/README.md)
