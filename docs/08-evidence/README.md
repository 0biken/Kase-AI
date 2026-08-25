# 08 — Evidence Store

Immutable artifacts. The reason a Kase finding is defensible rather than merely asserted.

---

## 1. Principle

> Real audits are defensible because the evidence is preserved.

Every finding points at artifacts that were captured at the time, hashed, and never rewritten. The AI review layer may add interpretation; it may **never** modify or replace evidence. If interpretation and evidence disagree, evidence wins.

## 2. Evidence record

```ts
Evidence {
  id: string
  auditId: string
  toolExecutionId: string | null
  tool: string
  type: EvidenceType
  replayable: boolean
  artifactUri: string        // s3://bucket/<projectId>/<auditId>/<sha256>
  sha256: string             // content address
  sizeBytes: number
  truncated: boolean
  redacted: boolean
  capturedAt: DateTime
  metadata: Json             // type-specific
}
```

Artifacts are **content-addressed**: the object key is the SHA-256 of the payload. Re-running an idempotent job overwrites identically instead of duplicating, which is what makes audit resumption safe.

## 3. Evidence types

| Type | Producer | Replayable | Typical size |
|---|---|---|---|
| `http_exchange` | http, httpx, nuclei | **Yes** | 1–500 KB |
| `sast_json` | semgrep, gitleaks | **Yes** | 10 KB–5 MB |
| `dependency_json` | deps | **Yes** | 10–500 KB |
| `axe_json` | axe | **Yes** | 20–200 KB |
| `test_output` | test runner | **Yes** | 1–100 KB |
| `source_excerpt` | codemap, agents | Yes (by commit) | 1–20 KB |
| `screenshot` | playwright | No | 50 KB–2 MB |
| `trace` | playwright | No | 1–50 MB |
| `console_log` | playwright | No | 1–500 KB |
| `network_log` | playwright | No | 100 KB–10 MB |
| `lighthouse_json` | lighthouse | No | 200 KB–2 MB |
| `crawl_result` | katana | No | 10 KB–5 MB |
| `git_metadata` | codemap | Yes | < 10 KB |

## 4. Replayability

`replayable` is not a description of the file format. It is a claim that **the evidence can be re-executed to reconfirm the finding**, and it is what gate eligibility is built on.

An artifact is replayable when it contains enough to deterministically re-derive the observation:

```ts
// http_exchange — replayable
{ method, url, headers, body, expectedStatus, replayHash }
   -> re-issue the request, compare
   -> confirms or refutes the finding

// screenshot — not replayable
{ png }
   -> proves something was rendered once
   -> cannot re-derive the defect automatically
```

Screenshots and traces are genuinely valuable — they are what a human reviewer looks at. They are simply not *self-verifying*, so they support a finding without being able to block a release on their own.

### Why not just count evidence

Requiring "at least two evidence artifacts" is weak: two screenshots of the same page is two artifacts and proves nothing extra. The gate therefore requires **at least one artifact of a replayable class**, not a count. See [12 §3](../12-policy-gate/README.md#3-evidence-class-gating).

## 5. Redaction

Redaction happens **at capture time, in the worker**, before the artifact is written. Post-hoc redaction of stored objects is not treated as sufficient.

### Registered secrets

At worker start, every secret the job will touch is registered with the redactor:

- target auth credentials (headers, cookies, tokens),
- repository access tokens,
- LLM API keys,
- any value pulled from the secret store.

The redactor performs literal replacement of registered values in all captured streams, replacing them with `[REDACTED:<label>]`.

### Pattern-based redaction

Applied in addition, for secrets Kase does not know about:

| Pattern class | Examples |
|---|---|
| Bearer tokens | `Authorization: Bearer ...` |
| Cookies | `Set-Cookie`, `Cookie` values |
| Cloud keys | AWS, GCP, Azure key formats |
| Private keys | PEM blocks |
| JWTs | three-segment base64 |
| Connection strings | `postgres://user:pass@...` |
| Provider tokens | GitHub, Slack, Stripe prefixes |

### Secret-scanner output is special-cased

`gitleaks` findings deliberately contain secrets. The adapter stores rule, file, enclosing symbol, line, and a partial fingerprint of the match — **never the matched value**. A finding that leaks the secret it is reporting has made the problem worse.

`Evidence.redacted` records whether any redaction occurred, so reviewers know an artifact is not byte-identical to the raw stream.

## 6. Size limits and truncation

| Type | Cap | Behaviour on exceed |
|---|---|---|
| `http_exchange` body | 1 MB | Truncate, hash full payload, set `truncated: true` |
| `trace` | 50 MB | Drop trace, keep console + network, log degradation |
| `network_log` | 10 MB | Truncate oldest entries |
| Any single artifact | 100 MB | Reject, mark job degraded |
| Total per audit | 5 GB | Stop capturing non-replayable evidence first |

Under pressure, **replayable evidence is preserved and non-replayable evidence is shed** — the ordering follows gate eligibility.

## 7. Immutability and integrity

- Bucket objects are write-once; the storage policy denies overwrite and delete to the application role.
- `sha256` is computed in the worker before upload and re-verified on read.
- Integrity failure on read marks the evidence `corrupt` and any finding depending solely on it becomes non-gate-eligible.
- Deletion happens only through the retention job, which writes a tombstone rather than removing the row.

## 8. Retention and tombstones

| Data | Retention |
|---|---|
| Replayable evidence | 90 days |
| Non-replayable evidence (traces, screenshots) | 30 days |
| Raw tool stdout | 30 days |
| Agent transcripts | 30 days |
| Evidence metadata rows | Indefinite |

Expiry writes a tombstone: `artifactUri` cleared, `sha256`, `sizeBytes`, `type`, and `metadata` retained. Historical findings remain explainable and their integrity claims remain checkable even after the bytes are gone.

## 9. Access

- Evidence is served through the API with project-scoped authorization, never via public bucket URLs.
- Download links are short-lived pre-signed URLs (15 min).
- Every evidence access is written to the audit trail ([18 §5](../18-observability/README.md#5-audit-trail)) — evidence can contain sensitive customer data and access to it is itself auditable.

---

**Next:** [09 — Finding Engine](../09-findings/README.md)
