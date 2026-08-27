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

`approver` is separate from `operator` precisely so `require_separate_approver` on waivers is enforceable ([12 §5](../12-policy-gate/README.md#5-waivers)).

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

## 10. Rate limits

| Caller | Limit |
|---|---|
| Session | 300 req/min |
| API token | 600 req/min |
| Audit creation | 10/hour/project |

`429` returns `Retry-After`.

## 11. Webhooks

```http
POST /api/v1/projects/:id/webhooks
```

Events: `audit.started`, `audit.completed`, `audit.degraded`, `finding.created`, `finding.regressed`, `gate.evaluated`, `waiver.expiring`.

Payloads are HMAC-signed (`X-Kase-Signature`) and delivered with retry and exponential backoff.

---

**Next:** [15 — CLI](../15-cli/README.md)
