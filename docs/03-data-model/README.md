# 03 — Data Model

Entities, relationships, and the schemas that constitute the system of record.

---

## 1. Entity map

```
Organization
 ├── User ─── ProjectMember (per-project role)
 ├── Invite            (pending; gates account creation)
 └── Project
      ├── Repository
      ├── Target
      ├── ScopePolicy
      ├── ApiToken       (CLI/CI credential, hashed at rest)
      ├── Integration ─── JiraIssue
      ├── GatePolicy
      ├── Waiver
      ├── Suppression
      ├── FindingIdentity  (fingerprint, cross-audit history)
      └── Audit
           ├── BuildProvenance
           ├── AuditJob
           │    └── ToolExecution
           ├── Evidence
           ├── EndpointInventory
           │    └── Endpoint
           ├── CodeMap
           │    └── RouteMapping
           ├── Finding
           │    ├── FindingEvidence
           │    ├── FindingRelation
           │    └── SourceLocation
           ├── Correlation
           ├── PassingCheck
           ├── Report
           └── GateEvaluation

AuditTrailEvent  (append-only; spans all of the above, no parent)
```

Two entities deserve attention because they are easy to get wrong:

- **`FindingIdentity`** is project-scoped, not audit-scoped. It carries the fingerprint and the lifecycle state that persists across audits. `Finding` is the per-audit *occurrence*.
- **`EndpointInventory`** is persisted, not transient. Both correlation and cross-audit regression need it, and endpoint appearance/disappearance between releases is itself reportable.

## 2. Core schemas

### Project

```ts
{
  id: string
  organizationId: string
  name: string
  slug: string
  defaultGatePolicyId: string
  createdAt: DateTime
}
```

### Repository

```ts
{
  id: string
  projectId: string
  provider: 'github'
  url: string
  defaultBranch: string
  credentialId: string | null   // -> encrypted secret
}
```

### Target

```ts
{
  id: string
  projectId: string
  name: string                  // "staging", "prod"
  baseUrl: string
  environment: 'production' | 'staging' | 'beta' | 'local'
  authMode: 'none' | 'header' | 'cookie' | 'oauth' | 'form'
  authCredentialId: string | null
  buildInfoUrl: string | null   // endpoint exposing the deployed commit SHA
}
```

### ScopePolicy

Enforced on every outbound request. See [17 — Security §3](../17-security/README.md#3-scope-validation).

```ts
{
  id: string
  projectId: string
  allowedHosts: string[]        // exact or wildcard, no bare TLDs
  deniedPaths: string[]
  maxRequestsPerSecond: number
  maxRequestsPerAudit: number
  destructiveAllowed: boolean   // default false
  authorizationAttestedBy: string
  authorizationAttestedAt: DateTime
}
```

### ProjectMember

Grants a session user a role on one project. `14 — API §2` puts the role on the *token* for CLI/CI callers, which leaves browser users with no derivable per-project role — this closes that gap. `ProjectScopeGuard` requires a row here for any session principal.

```ts
{
  userId: string
  projectId: string
  role: 'viewer' | 'operator' | 'approver' | 'admin'
  createdAt: DateTime
}                               // composite PK: (userId, projectId)
```

### Invite

Gates account creation. Per [ADR-013](../20-adr/README.md#adr-013--rs256-sessions-sha-256-tokens-flat-roles-invite-only), signing in with Google, GitHub or Apple proves *who someone is*; it never proves they are allowed in. A `User` row is created only when a pending invite matches the provider's **verified** email.

```ts
{
  id: string
  email: string
  organizationId: string
  role: 'viewer' | 'operator' | 'approver' | 'admin'
  projectIds: string[]          // enrolled on acceptance; empty is valid
  invitedBy: string
  expiresAt: DateTime
  acceptedAt: DateTime | null
  acceptedUserId: string | null // links the invite to the User it created
  createdAt: DateTime
}                               // unique: (email, organizationId)
```

Acceptance — creating the `User`, its `ProjectMember` rows, and marking the invite used — happens in **one transaction**. A user without their memberships, or an invite marked accepted with no user, are both states nothing else would repair.

### ApiToken

The CLI/CI credential, presented as `Authorization: Bearer kase_...`.

```ts
{
  id: string
  projectId: string             // a token is scoped to exactly one project
  name: string
  tokenHash: string             // SHA-256 of the plaintext, unique
  displayPrefix: string         // leading chars, for listing; never for lookup
  role: 'viewer' | 'operator' | 'approver' | 'admin'
  createdBy: string
  createdAt: DateTime
  lastUsedAt: DateTime | null
  expiresAt: DateTime | null
  revokedAt: DateTime | null
}
```

**SHA-256, not a password hash.** Tokens are high-entropy random values, so brute force is infeasible and a memory-hard hash buys nothing while adding latency to a 600 req/min path ([14 §10](../14-api/README.md)).

**Revocation is a timestamp, not a delete.** Audit-trail entries referencing a token must keep resolving ([17 §9](../17-security/README.md)).

The plaintext is returned exactly once, at creation. Afterwards only `displayPrefix` is ever shown.

### AuditTrailEvent

Append-only, retained indefinitely, per [17 — Security §9](../17-security/README.md). Records authn/authz decisions, project and policy changes **with diffs**, scope denials, evidence access, and secret lifecycle events (never values).

```ts
{
  id: string
  projectId: string | null      // null: a failed auth has no project yet
  actorType: 'user' | 'token' | 'system'
  actorId: string | null
  action: string                // 'project.update', 'auth.denied', 'scope.denied'
  resourceType: string | null
  resourceId: string | null
  diff: object | null           // before/after; §9 requires diffs on policy changes
  metadata: object | null
  outcome: 'allowed' | 'denied' | 'error'
  createdAt: DateTime
}
```

It deliberately has **no parent entity**. A denied authentication has no project, and an event that could not be written because its parent did not exist would be exactly the event worth keeping.

### Audit

```ts
{
  id: string
  projectId: string
  mode: 'full' | 'smoke' | 'security' | 'regression'
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  degraded: boolean             // budget or tool degradation occurred
  degradationReasons: string[]
  requestedCategories: string[]
  executedCategories: string[]
  notExecutedCategories: { category: string, reason: string }[]
  buildProvenanceId: string
  startedAt: DateTime
  completedAt: DateTime | null
}
```

`status: 'partial'` and `degraded: true` both feed the gate. Neither can produce PASS. See [12](../12-policy-gate/README.md).

### BuildProvenance

The binding that makes correlation trustworthy.

```ts
{
  id: string
  auditId: string
  commitSha: string | null
  branch: string | null
  buildId: string | null
  source: 'ci_supplied' | 'build_info_endpoint' | 'response_header' | 'assumed'
  verified: boolean             // false when source === 'assumed'
  targetFingerprint: string      // hash of asset digests observed at target
  resolvedAt: DateTime
}
```

When `verified === false`, every `Correlation` produced in this audit is written with `verified: false` and is excluded from gate evaluation.

### AuditJob / ToolExecution

```ts
AuditJob {
  id: string
  auditId: string
  kind: 'recon' | 'blackbox_agent' | 'whitebox_agent' | 'tool' | 'correlate' | 'report'
  category: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'timed_out'
  dependsOn: string[]
  attempts: number
  startedAt: DateTime | null
  finishedAt: DateTime | null
  error: string | null
}

ToolExecution {
  id: string
  auditJobId: string
  tool: string                  // 'semgrep'
  toolVersion: string           // pinned, recorded for explainability
  imageDigest: string
  capability: string            // 'run_sast'
  argumentsHash: string
  exitCode: number | null
  durationMs: number
  requestCount: number          // counts against ScopePolicy budget
  evidenceIds: string[]
}
```

### Evidence

Immutable. See [08](../08-evidence/README.md).

```ts
{
  id: string
  auditId: string
  toolExecutionId: string | null
  tool: string
  type: 'http_exchange' | 'screenshot' | 'trace' | 'console_log' | 'network_log'
      | 'lighthouse_json' | 'axe_json' | 'sast_json' | 'dependency_json'
      | 'source_excerpt' | 'git_metadata' | 'crawl_result' | 'test_output'
  replayable: boolean           // gate-relevant, see §3
  artifactUri: string           // s3://...
  sha256: string
  sizeBytes: number
  redacted: boolean
  capturedAt: DateTime
  metadata: Json
}
```

### Endpoint

```ts
{
  id: string
  inventoryId: string
  method: string
  pathTemplate: string          // '/api/invoices/{id}' — normalized
  rawExamples: string[]         // '/api/invoices/123'
  discoveredBy: string[]        // ['katana','openapi','playwright']
  statusObserved: number[]
  contentType: string | null
  requiresAuth: boolean | null
  parameters: { name, in, type }[]
  firstSeenAuditId: string
  lastSeenAuditId: string
}
```

### RouteMapping (from the Code Map)

```ts
{
  id: string
  codeMapId: string
  method: string
  pathTemplate: string
  framework: 'nestjs' | 'express' | 'fastapi' | 'django'
  handlerSymbol: string         // 'InvoiceController.findOne'
  file: string
  line: number
  middleware: string[]
  serviceSymbols: string[]
  source: 'runtime_dump' | 'openapi' | 'static_parse'
}
```

`source` ranks confidence — see [10 — Correlation §3](../10-correlation/README.md#3-layer-1--deterministic-mapping).

### Finding (per-audit occurrence)

```ts
{
  id: string
  auditId: string
  identityId: string            // -> FindingIdentity (fingerprint)
  origin: 'blackbox' | 'whitebox' | 'tool' | 'correlated'
  category: string
  ruleId: string | null         // deterministic tools only
  cwe: string | null
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  severitySource: 'engine'      // always; tools never set severity
  affectedTarget: string | null // normalized path template
  description: string
  reproduction: Json            // structured + replayable, see §3
  impact: string
  rootCause: string | null      // AI-authored — never enters the fingerprint
  fix: string
  fixPatch: string | null       // unified diff where available
  confidenceBand: 'high' | 'medium' | 'low'
  aiGenerated: boolean
  gateEligible: boolean         // derived, see §3
  sourceLocations: SourceLocation[]
  evidenceIds: string[]
}
```

### SourceLocation

Line numbers are unstable across edits. The **enclosing symbol** is the stable identifier and is what the fingerprint uses.

```ts
{
  file: string
  enclosingSymbol: string       // 'InvoiceController.findOne'
  line: number                  // display only
  endLine: number | null
  commitSha: string
  verified: boolean             // inherits BuildProvenance.verified
}
```

### FindingIdentity (project-scoped, cross-audit)

```ts
{
  id: string
  projectId: string
  fingerprint: string           // sha256, deterministic inputs only
  status: 'new' | 'open' | 'fixed' | 'verified' | 'regressed'
        | 'not_reproduced' | 'false_positive' | 'accepted_risk'
  firstSeenAuditId: string
  lastSeenAuditId: string
  occurrences: number
  currentSeverity: string
  waiverId: string | null
}
```

Lifecycle transitions: [09 — Findings §6](../09-findings/README.md#6-lifecycle).

### Correlation

```ts
{
  id: string
  auditId: string
  blackboxFindingId: string
  whiteboxFindingId: string | null
  endpointId: string | null
  routeMappingId: string | null
  method: 'runtime_dump' | 'openapi' | 'static_parse' | 'request_id' | 'ai_inference'
  confidenceBand: 'high' | 'medium' | 'low'
  verified: boolean             // false if BuildProvenance unverified
  rationale: string
  alternativesConsidered: Json | null   // required when method === 'ai_inference'
}
```

### PassingCheck

Both skills require passing checks to be logged. Without this, "tested and clean" is indistinguishable from "never tested" — which the gate needs to tell apart.

```ts
{
  id: string
  auditId: string
  category: string
  checkId: string
  target: string | null
  evidenceIds: string[]
  observedAt: DateTime
}
```

### GatePolicy / GateEvaluation / Waiver

See [12 — Policy Engine](../12-policy-gate/README.md) for semantics.

```ts
GateEvaluation {
  id: string
  auditId: string
  gatePolicyId: string
  gatePolicyVersion: number
  outcome: 'pass' | 'fail' | 'partial'
  blockingFindingIds: string[]
  waivedFindingIds: string[]
  notExecutedCategories: string[]
  commitSha: string | null
  evaluatedAt: DateTime
}

Waiver {
  id: string
  projectId: string
  fingerprint: string           // scoped to identity, not Finding.id
  reason: string
  requestedBy: string
  approvedBy: string            // may be required !== requestedBy by policy
  approvedAt: DateTime
  expiresAt: DateTime           // mandatory; no permanent waivers
  affectedRelease: string | null
}

Suppression {
  id: string
  projectId: string
  fingerprint: string
  markedBy: string
  reason: string
  createdAt: DateTime
}
```

`Waiver` is time-boxed and intentional. `Suppression` records a confirmed false positive so humans do not re-triage the same noise every run. `accepted_risk` on `FindingIdentity` is the third, permanent-by-decision case. All three are distinct.

## 3. Two derived fields worth understanding

### `Evidence.replayable`

True when the artifact can be re-executed to reconfirm the finding — a stored HTTP exchange that can be replayed, a scanner rule hit with `file:symbol`, or a failing test case. False for screenshots, prose, traces, and console dumps.

Gate eligibility depends on this, not on a confidence number. See [12 §3](../12-policy-gate/README.md#3-evidence-class-gating).

### `Finding.gateEligible`

```
gateEligible =
     severity in policy.blockingSeverities
  && exists(evidence where replayable === true)
  && (origin !== 'correlated' || correlation.verified === true)
  && identity.status not in ('false_positive', 'accepted_risk')
```

Deliberately no `confidence >= 0.90` term. An LLM-emitted probability is not calibrated and drifts between model versions; deterministic gates must not do arithmetic on it.

## 4. Indexing notes

| Table | Index | Reason |
|---|---|---|
| `FindingIdentity` | `(projectId, fingerprint)` unique | Identity resolution on every ingest |
| `Finding` | `(auditId, category, severity)` | Report and dashboard queries |
| `Evidence` | `(auditId, type)` | Report assembly |
| `Endpoint` | `(inventoryId, method, pathTemplate)` unique | Inventory merge |
| `ToolExecution` | `(auditJobId)` | Job drill-down |
| `Waiver` | `(projectId, fingerprint, expiresAt)` | Gate evaluation and expiry warnings |

## 5. Retention

| Data | Default retention |
|---|---|
| Findings, identities, gate evaluations | Indefinite |
| Evidence artifacts | 90 days, then metadata-only tombstone |
| Raw tool stdout | 30 days |
| Agent transcripts | 30 days |

Tombstoned evidence keeps `sha256` and `metadata` so historical findings remain auditable even after the artifact is expired.

---

**Next:** [04 — Audit Orchestrator](../04-orchestrator/README.md)
