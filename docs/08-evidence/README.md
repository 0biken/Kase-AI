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
  artifactUri: string | null // s3://bucket/<projectId>/<auditId>/<sha256>; null after expiry
  sha256: string             // hash of the stored, redacted bytes
  fullRedactedSha256: string | null // full redacted stream when stored bytes are truncated
  sizeBytes: number
  truncated: boolean
  redacted: boolean
  capturedAt: DateTime
  expiresAt: DateTime
  objectDeletedAt: DateTime | null
  tombstonedAt: DateTime | null
  metadata: Json             // type-specific and safe for indefinite retention
}
```

Artifacts are **content-addressed**: the object key is the SHA-256 of the bytes
actually stored after mandatory redaction and any truncation. Re-running an
idempotent job resolves to the same object instead of duplicating it, which is
what makes audit resumption safe.

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

Redaction is **mandatory and non-disableable**. It happens at capture time in the
worker, before truncation, hashing, or upload. Post-hoc redaction of stored
objects is not sufficient, and neither an organization nor a project can weaken
the baseline. Customer-defined patterns are additive.

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
| Kase API tokens | `kase_...` — 14 §2 |
| Payment cards | PAN-like values that pass checksum validation |
| Government IDs | supported country-specific identifier formats |
| Ordinary PII | email addresses, phone numbers, and IP addresses |

Sensitive request and response headers and all cookie values are redacted by
field name even when their value does not match a known pattern. Ordinary PII is
replaced with a stable **per-audit pseudonym**, derived with an audit-scoped HMAC
key, so repeated values can still be correlated within one audit. Pseudonyms are
not stable across audits, and neither the source PII nor the HMAC key is stored
with evidence.

### Secret-scanner output is special-cased

Secret-scanner findings deliberately contain secrets. The adapter stores rule,
file, enclosing symbol, line, and a keyed partial fingerprint of the match —
**never the raw match, surrounding secret-bearing excerpt, or reversible
encoding**. A finding that leaks the secret it is reporting has made the problem
worse.

`Evidence.redacted` records whether any redaction occurred, so reviewers know an artifact is not byte-identical to the raw stream.

### Processing and hashing order

The worker applies registered-secret replacement, sensitive header/cookie
filtering, baseline and customer patterns, and ordinary-PII pseudonymization to
the complete capture stream. It then hashes that full redacted stream. If a cap
requires truncation, it stores the truncated redacted bytes, sets `truncated:
true`, records their hash in `sha256`, and records the pre-truncation redacted
hash in `fullRedactedSha256`. Only the stored-byte hash is used in the object key.
Untruncated evidence has `fullRedactedSha256: null` because `sha256` already
covers the full redacted content.

Binary evidence is admitted only when its capture adapter can prove the baseline
redaction policy was applied safely. An unsafe screenshot, trace, archive, or
other opaque binary is dropped rather than uploaded; Kase emits
`evidence.capture_rejected`, adds a safe reason to `Audit.degradationReasons`,
and sets `Audit.degraded = true`.

## 6. Size limits and truncation

| Type | Cap | Behaviour on exceed |
|---|---|---|
| `http_exchange` body | 1 MB | Redact, hash full redacted payload, truncate, set `truncated: true` |
| `trace` | 50 MB | Drop trace, keep safely redacted console + network, mark audit degraded |
| `network_log` | 10 MB | Truncate oldest entries |
| Any single artifact | 100 MB | Reject, mark job degraded |
| Total per audit | 5 GB | Stop capturing non-replayable evidence first |

Under pressure, **replayable evidence is preserved and non-replayable evidence is shed** — the ordering follows gate eligibility.

## 7. Immutability and integrity

- Bucket objects are write-once; the storage policy denies overwrite and delete to the application role.
- `sha256` is computed over stored redacted bytes before upload and re-verified on read.
- Integrity failure on read marks the evidence `corrupt` and any finding depending solely on it becomes non-gate-eligible.
- Deletion happens only through the retention job, which writes a tombstone rather than removing the row.

## 8. Retention, inheritance, and tombstones

| Data | Retention |
|---|---|
| Replayable evidence | 90 days |
| Non-replayable evidence (traces, screenshots) | 30 days |
| Raw tool stdout | 30 days |
| Agent transcripts | 30 days |
| Sanitized evidence metadata tombstones | Indefinite |
| Audit-trail events | Indefinite |

Every retention value is an integer from **1 through 365 days**. Organization
administrators set organization defaults, and project administrators may set a
nullable override for each class. Effective precedence is **project override →
organization default → platform default**; null means inherit.

Expiry is computed at capture. Shortening a policy reschedules existing live
artifacts to the earlier deadline. Extending a policy affects new captures only:
it never extends an existing deletion commitment and never resurrects deleted
bytes or a tombstone.

At expiry, the retention worker hard-deletes the object bytes. It treats an
already-missing object as success so retries are idempotent, then clears
`artifactUri` and records `objectDeletedAt` and `tombstonedAt` in a short database
transaction. The sanitized metadata row is retained indefinitely with `sha256`,
`fullRedactedSha256`, `sizeBytes`, `type`, safe `metadata`, and `expiresAt`.
Historical findings remain explainable without retaining customer content. Audit
trail records are also retained indefinitely. v1 does not provide legal holds.

Retention scans use an index over `expiresAt` for rows where `tombstonedAt IS
NULL`, bounded batches, and short transactions; the concrete future PostgreSQL
contract is specified in [03 §5](../03-data-model/README.md#5-retention).

## 9. Access

- Evidence is served through the API with project-scoped authorization, never via public bucket URLs.
- Download links are short-lived pre-signed URLs (15 min).
- A download or replay request for tombstoned evidence returns an RFC 9457 `410 Gone`; it never returns a URL or queues replay.
- Every evidence access is written to the audit trail ([18 §5](../18-observability/README.md#5-audit-trail)) — evidence can contain sensitive customer data and access to it is itself auditable.

---

**Next:** [09 — Finding Engine](../09-findings/README.md)
