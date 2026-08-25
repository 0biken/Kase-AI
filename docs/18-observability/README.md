# 18 — Observability

Metrics, traces, logs, and the product signals that tell you whether Kase is working.

---

## 1. Stack

OpenTelemetry for traces and metrics; structured JSON logs. Every signal carries `auditId`, and where applicable `projectId`, `jobId`, and `toolExecutionId`, so any log line can be traced to the audit that produced it.

## 2. Metrics

### Execution

| Metric | Type | Labels |
|---|---|---|
| `kase.audit.duration` | histogram | mode, status, degraded |
| `kase.audit.count` | counter | mode, status |
| `kase.job.duration` | histogram | kind, category, status |
| `kase.job.retries` | counter | kind, reason |
| `kase.tool.execution.duration` | histogram | tool, version |
| `kase.tool.failure` | counter | tool, reason |
| `kase.queue.depth` | gauge | queue |
| `kase.worker.active` | gauge | worker class |

### Findings

| Metric | Type | Labels |
|---|---|---|
| `kase.findings.created` | counter | severity, category, origin |
| `kase.findings.gate_eligible` | counter | severity |
| `kase.findings.deduplicated` | counter | level (1/2/3), outcome |
| `kase.correlation.attempted` | counter | method |
| `kase.correlation.succeeded` | counter | method, verified |
| `kase.findings.false_positive` | counter | category, tool |

### AI and cost

| Metric | Type | Labels |
|---|---|---|
| `kase.ai.tokens` | counter | stage, provider, model, direction |
| `kase.ai.cost_usd` | counter | stage, provider, model |
| `kase.ai.latency` | histogram | stage, provider |
| `kase.ai.calls` | counter | stage, outcome |
| `kase.budget.state` | gauge | audit, dimension (tokens/time/requests) |
| `kase.audit.cost_usd` | histogram | mode |

### Target impact

The metrics that matter to the customer whose system is being probed.

| Metric | Type | Labels |
|---|---|---|
| `kase.target.requests` | counter | target host, tool |
| `kase.target.rate` | gauge | target host |
| `kase.target.errors` | counter | target host, status class |
| `kase.scope.denied` | counter | reason, source |

A rising `kase.target.errors` 5xx rate during an audit means Kase may be degrading the system it is testing. This warrants an alert, not a dashboard tile.

## 3. Traces

One trace per audit; spans mirror the job graph.

```
audit aud_01H2X4                                        24m
├── scope_validate                                      120ms
├── build_provenance                                    2.1s
│   └── resolve source=ci_supplied verified=true
├── recon                                               4m12s
│   ├── katana.crawl                                    3m40s
│   ├── scope_filter    (candidates 412 -> allowed 388)  90ms
│   └── httpx.probe                                     28s
├── blackbox_agent                                      11m04s
│   ├── ai.call stage=blackbox                          8.2s
│   ├── tool.run_http_probe                             340ms
│   └── ... (94 spans)
├── whitebox_agent                                      6m18s
│   ├── tool.run_sast                                   2m10s
│   └── ai.call stage=whitebox                          12.4s
├── normalize                                           1.2s
├── ingest_dedup                                        400ms
├── correlate                                           38s
├── fingerprint_dedup                                   900ms
├── ai_review                                           1m20s
├── report                                              22s
└── gate_evaluate                                       3.4s
    └── replay EV-124  reproduced                       210ms
```

Sensitive span attributes pass the redactor before export.

## 4. Logs

Structured JSON, one event per line.

```json
{
  "ts": "2026-08-24T11:04:22.104Z",
  "level": "warn",
  "event": "scope_denied",
  "auditId": "aud_01H2X4",
  "projectId": "prj_01H...",
  "jobId": "job_01H...",
  "url": "https://cdn.othersite.com/asset.js",
  "reason": "host_not_allowed",
  "discoveredBy": "katana",
  "msg": "Discovered URL rejected by scope policy"
}
```

### Log rules

| Rule | Reason |
|---|---|
| Credentials never logged | Redactor runs on every log write, not just evidence capture |
| Evidence payloads never logged | Reference by `evidenceId` only |
| Every scope denial logged at `warn` | Both a security signal and a scope-tuning signal |
| Agent tool calls logged with arguments hash, not arguments | Arguments can contain target data |
| Log volume bounded per audit | A runaway agent must not fill the log pipeline |

## 5. Audit trail

Distinct from operational logs: append-only, indefinitely retained, queryable through the API. Contents listed in [17 §9](../17-security/README.md#9-audit-trail).

Operational logs answer *why was it slow*. The audit trail answers *who did what, and what did the system decide*. They have different retention, different access control, and different consumers.

## 6. Alerts

| Alert | Condition | Severity |
|---|---|---|
| Target error rate | 5xx from a target > 5% during an audit | **Page** — Kase may be degrading a customer system |
| Rate limit breach | Observed RPS > policy | **Page** |
| Scope denial spike | > 50 denials in one audit | Warn — allowlist likely wrong, or a crawl escaped |
| Audit failure rate | > 20% over 1h | Page |
| Queue depth | > 50 for 10 min | Warn |
| AI cost | Audit cost > 3× median for its mode | Warn |
| Tool failure rate | One tool failing > 30% over 1h | Warn — likely a version or image problem |
| Gate flap | Same project alternating PASS/FAIL on unchanged commits | Warn — determinism problem, investigate |
| Waiver expiring | Any waiver within 7 days | Info to project owner |

The first two page because they concern damage to a customer's system rather than to Kase.

## 7. Product health metrics

These decide whether Kase is worth running, and should be reviewed as deliberately as the operational ones.

| Metric | Target | Why |
|---|---|---|
| False-positive rate | < 10% of gate-eligible findings | Above this, the gate loses credibility and gets disabled |
| Correlation success rate | > 60% of black-box findings get a source location | The differentiator, measured directly |
| Correlation accuracy | > 95% of verified correlations confirmed correct on review | A wrong `file:line` is worse than none |
| Gate flap rate | < 2% of consecutive runs on unchanged commits | Determinism, measured rather than assumed |
| Median audit cost | Below the engineering time it saves | Viability |
| Time to first finding | < 5 min | Perceived responsiveness |
| Suppression growth | Flat over time | Rising suppressions means rising noise |

**Correlation accuracy is the number that decides the product.** Sample verified correlations, have an engineer confirm or reject them, and track the rate. If it drops below ~95%, engineers stop trusting source locations and Kase degrades into the tool aggregator it was designed not to be.

## 8. Dashboards

| Dashboard | Audience |
|---|---|
| Platform health | Queue, workers, tool failures, error rates |
| Audit execution | Durations by stage, retries, degradation causes |
| Cost | Tokens and USD by stage, mode, and project |
| Target impact | Requests, rate, errors per target host |
| Product health | The §7 metrics, trended |

---

**Next:** [19 — Roadmap](../19-roadmap/README.md)
