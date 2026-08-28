# 14 — REST API

Endpoints, authentication, conventions.

---

## 1. Conventions

| Aspect | Rule |
|---|---|
| Base | `/api/v1` |
| Format | JSON; `application/json` |
| IDs | Prefixed ULIDs (`aud_01H...`, `fnd_01H...`) |
| Time | ISO 8601 UTC |
| Pagination | Cursor-based: `?limit=50&cursor=...` |
| Errors | RFC 9457 problem details |
| Idempotency | `Idempotency-Key` header on all POSTs |
| Versioning | URL-versioned; breaking changes bump the version |

### Error shape

```json
{
  "type": "https://kase.dev/errors/scope-violation",
  "title": "Target host not in scope policy",
  "status": 422,
  "detail": "Host 'api.other.com' is not in allowedHosts for project acme-web.",
  "instance": "/api/v1/projects/prj_01H.../audits",
  "code": "SCOPE_VIOLATION"
}
```

## 2. Authentication

| Caller | Credential |
|---|---|
| Browser | Auth.js session → short-lived JWT |
| CLI / CI | Project API token, `Authorization: Bearer kase_...` |

Tokens are hashed at rest, scoped to one project, and carry a role (`viewer`, `operator`, `approver`, `admin`). Every request additionally passes `ProjectScopeGuard`.

| Role | Can |
|---|---|
| `viewer` | Read audits, findings, reports |
| `operator` | Start and cancel audits, create Jira issues |
| `approver` | Approve waivers, mark false positives, accept risk |
| `admin` | Manage projects, scope policies, gate policies, integrations |

`approver` is separate from `operator` precisely so `require_separate_approver` on waivers is enforceable ([12 §5](../12-policy-gate/README.md#5-waivers)). Roles are checked by set membership, never rank — `admin` does not implicitly satisfy an `approver`-only or `operator`-only route ([20 — ADR-013](../20-adr/README.md#adr-013--rs256-sessions-sha-256-tokens-flat-roles-invite-only)).

### Managing tokens

```http
POST   /api/v1/projects/:id/tokens
GET    /api/v1/projects/:id/tokens
DELETE /api/v1/projects/:id/tokens/:tokenId
```

All three are `admin`-only — even listing, since a token's name and `displayPrefix` already say who can act as what on the project. The plaintext is returned exactly once, in the `POST` response; every later read shows only `displayPrefix` (the leading characters, e.g. `kase_ab3f`) alongside `role`, `createdAt`, `lastUsedAt`, and `expiresAt`. `DELETE` revokes rather than deletes — the row (and its `displayPrefix`) has to keep resolving for anything that already cited it in the audit trail ([17 §9](../17-security/README.md)).

### Creating and listing projects

`POST`/`GET /api/v1/projects` are organization-level: a project cannot be project-scoped before it exists, so `ProjectScopeGuard` treats them as a distinct case rather than resolving a project id. Only a session principal may call them — an API token is always scoped to one existing project (this section, above) and has no organization to act across. Any session user belonging to the organization may call either; v1 has no organization-level role beyond that, matching 17 §8 ("v1 is single-organization"). The user who creates a project is automatically enrolled as that project's first `admin`, in the same transaction as project creation — otherwise they would fail `ProjectScopeGuard` on their own project immediately afterward.

## 3. Projects

```http
POST   /api/v1/projects
GET    /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id
```

```json
POST /api/v1/projects
{
  "name": "Acme Web",
  "repository": {
    "provider": "github",
    "url": "https://github.com/acme/web",
    "defaultBranch": "main"
  },
  "targets": [
    { "name": "staging", "baseUrl": "https://staging.acme.com",
      "environment": "staging", "buildInfoUrl": "https://staging.acme.com/healthz" }
  ],
  "scopePolicy": {
    "allowedHosts": ["staging.acme.com", "*.staging.acme.com"],
    "maxRequestsPerSecond": 10,
    "maxRequestsPerAudit": 5000,
    "destructiveAllowed": false,
    "authorizationAttestedBy": "alex@acme.com"
  }
}
```

`scopePolicy.authorizationAttestedBy` is mandatory. A project cannot be created without an attestation that the requester is authorized to test the target.

### Repositories and targets

The create payload above nests `repository` and `targets`, which covers project setup but leaves no way to add a target later without replacing the project. These sub-resources fill that gap, following the same `/projects/:id/<child>` shape as scope policies, gate policies, audits, and waivers:

```http
GET    /api/v1/projects/:id/repositories
POST   /api/v1/projects/:id/repositories
PATCH  /api/v1/projects/:id/repositories/:repositoryId
DELETE /api/v1/projects/:id/repositories/:repositoryId

GET    /api/v1/projects/:id/targets
POST   /api/v1/projects/:id/targets
PATCH  /api/v1/projects/:id/targets/:targetId
DELETE /api/v1/projects/:id/targets/:targetId
```

These stay **fully nested** rather than collapsing to `/targets/:id` once the ID is known. The flatter shape is more conventional, but it drops the project from the path, and every such route then depends on `ProjectScopeGuard` loading the row to discover which project it belongs to. Keeping the project in the path means the scope check reads it directly and a missing resolver cannot fail open. The handler also verifies the child actually belongs to the project in the path, so a valid target ID under the wrong project is a 404, not a cross-tenant edit.

Mutating a **production** target invalidates the project's authorization attestation and requires re-attestation before the next audit ([17 §3](../17-security/README.md#3-scope-validation)). Changing what is being tested invalidates the statement that testing it was authorized.

## 4. Scope and gate policies

```http
GET   /api/v1/projects/:id/scope-policy
PUT   /api/v1/projects/:id/scope-policy
GET   /api/v1/projects/:id/gate-policies
POST  /api/v1/projects/:id/gate-policies      # creates a new version
GET   /api/v1/gate-policies/:id
```

Gate policies are immutable once created; edits produce a new version. Gate evaluations reference the exact version used.

## 5. Audits

```http
POST   /api/v1/projects/:id/audits
GET    /api/v1/projects/:id/audits
GET    /api/v1/audits/:id
POST   /api/v1/audits/:id/cancel
GET    /api/v1/audits/:id/jobs
GET    /api/v1/audits/:id/events        # SSE stream
GET    /api/v1/audits/:id/inventory
GET    /api/v1/audits/:id/coverage
```

```json
POST /api/v1/projects/prj_01H.../audits
{
  "mode": "full",
  "targetId": "tgt_01H...",
  "commitSha": "a3f9c1e",
  "routeMap": { "framework": "nestjs", "routes": [ ... ] },
  "categories": ["security", "authz", "static_security", "dependencies"],
  "budgetOverrides": { "maxWallMinutes": 45 }
}
```

Response includes `buildProvenance`, so a caller sees immediately whether correlation will be gate-eligible:

```json
{
  "id": "aud_01H...",
  "status": "queued",
  "buildProvenance": {
    "commitSha": "a3f9c1e",
    "source": "ci_supplied",
    "verified": true
  }
}
```

### Progress stream

`GET /audits/:id/events` is server-sent events, so the dashboard and CLI never poll the tools directly.

```
event: job
data: {"jobId":"job_...","kind":"recon","status":"succeeded","durationMs":48210}

event: budget
data: {"state":"yellow","tokensUsed":1050000,"requestsToTarget":2140}

event: finding
data: {"findingId":"fnd_...","severity":"critical","category":"authz"}

event: status
data: {"status":"completed","degraded":false}
```

## 6. Findings

```http
GET   /api/v1/audits/:id/findings
GET   /api/v1/findings/:id
PATCH /api/v1/findings/:id                 # lifecycle transitions
GET   /api/v1/projects/:id/finding-identities
GET   /api/v1/finding-identities/:id/history
POST  /api/v1/findings/:id/jira
```

Filters: `?severity=critical,high&category=authz&status=open&gateEligible=true&origin=correlated`

```json
PATCH /api/v1/findings/fnd_01H...
{ "status": "false_positive", "reason": "Endpoint is admin-only behind VPN." }
```

Transitioning to `false_positive` creates a project-scoped `Suppression` keyed on the fingerprint, so the same noise does not return next run. Requires `approver`.

### Suppressions

The suppression store is readable and writable directly, not only as a side effect of a `false_positive` transition — otherwise there is no way to review what has been silenced, or to un-silence it.

```http
GET    /api/v1/projects/:id/suppressions
POST   /api/v1/projects/:id/suppressions     # approver
DELETE /api/v1/suppressions/:id              # approver — un-suppress
```

Deleting a suppression does not resurrect the old finding; the fingerprint simply stops being filtered, so the next audit that observes it reports it as `new`.

### Passing checks

```http
GET /api/v1/audits/:id/passing-checks
```

`PassingCheck` is a first-class entity ([03 §2](../03-data-model/README.md), [ADR-009](../20-adr/README.md)) precisely so coverage is reportable: "we checked authz on these 14 endpoints and found nothing" is a different statement from "we did not check". Without this endpoint the dashboard's coverage view cannot distinguish them, which is the failure ADR-009 exists to prevent.

## 7. Waivers

```http
POST   /api/v1/projects/:id/waivers
GET    /api/v1/projects/:id/waivers
DELETE /api/v1/waivers/:id
GET    /api/v1/projects/:id/waivers/expiring    # default window 7 days
```

```json
POST /api/v1/projects/prj_01H.../waivers
{
  "fingerprint": "2b7e...",
  "reason": "Fix scheduled for release 4.2; endpoint restricted to internal VPN meanwhile.",
  "expiresAt": "2026-09-15T00:00:00Z",
  "affectedRelease": "4.1.3"
}
```

Server-enforced: `expiresAt` is mandatory and within `gatePolicy.waivers.max_duration_days`; the approver must differ from the requester when policy requires it.

## 8. Evidence

```http
GET /api/v1/audits/:id/evidence
GET /api/v1/evidence/:id
GET /api/v1/evidence/:id/download        # 15-minute pre-signed URL
POST /api/v1/evidence/:id/replay         # replayable classes only
```

Every access is written to the audit trail. Evidence can contain customer data; reading it is itself auditable.

## 9. Reports and gate

```http
GET  /api/v1/audits/:id/report?format=json|markdown|html
POST /api/v1/audits/:id/gate               # evaluate
GET  /api/v1/audits/:id/gate               # last evaluation
```

Gate response is the full explainable object from [12 §8](../12-policy-gate/README.md#8-gate-evaluation-output).

## 10. Integrations

Configuration surface for [13 — Integrations](../13-integrations/README.md). All routes require `admin`.

```http
GET    /api/v1/projects/:id/integrations
GET    /api/v1/integrations/:id
PATCH  /api/v1/integrations/:id
DELETE /api/v1/integrations/:id
```

Neither integration is created by a plain `POST` with a credential in the body, because neither issues credentials that way.

### GitHub App installation

```http
GET  /api/v1/projects/:id/integrations/github/install-url
GET  /api/v1/integrations/github/callback      # GitHub redirects here post-install
```

The install URL sends the admin to GitHub's own installation screen; the callback exchanges the `installation_id` for the record. Installation tokens are short-lived and resolved per job ([13 §1](../13-integrations/README.md#1-github)) — **no long-lived repository credential is ever stored**, so there is no endpoint that accepts one.

### Jira 3LO

```http
GET  /api/v1/projects/:id/integrations/jira/authorize-url
GET  /api/v1/integrations/jira/callback        # Atlassian redirects here
PUT  /api/v1/integrations/:id/jira-config      # projectKey, issueType, mappings
```

The OAuth exchange happens server-side; the refresh token is encrypted at rest per [02 §4](../02-stack/README.md#4-secrets-management-is-a-first-class-requirement). `jira-config` is separated from the credential deliberately — editing a severity-field mapping is a routine change, and it should not require re-authorizing, or tempt anyone into a shape where the config write can also carry a credential.

Both callbacks verify `state`. Credential values are never returned by any `GET`; a read shows connection status, scopes, and the account or installation identity only.

## 11. Rate limits

| Caller | Limit |
|---|---|
| Session | 300 req/min |
| API token | 600 req/min |
| Audit creation | 10/hour/project |

`429` returns `Retry-After`.

## 12. Webhooks

```http
POST /api/v1/projects/:id/webhooks
```

Events: `audit.started`, `audit.completed`, `audit.degraded`, `finding.created`, `finding.regressed`, `gate.evaluated`, `waiver.expiring`.

Payloads are HMAC-signed (`X-Kase-Signature`) and delivered with retry and exponential backoff.

---

**Next:** [15 — CLI](../15-cli/README.md)
