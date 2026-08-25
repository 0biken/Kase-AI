# 06 — Recon & Endpoint Inventory

Open-source crawling and discovery, and the canonical inventory that joins black-box to white-box.

---

## 1. Why recon is a first-class subsystem

The obvious argument for adding a crawler is coverage. The stronger argument is **correlation**.

The Endpoint Inventory is the join key between the two audits:

```
Katana discovers:                 White box builds Code Map:
  GET  /api/users                   src/users/user.controller.ts
  GET  /api/users/{id}              src/orders/order.controller.ts
  GET  /api/orders/{id}             ...
  GET  /admin/users
            |                                    |
            +----------------+-------------------+
                             v
                   ENDPOINT INVENTORY
                   (canonical path templates)
                             v
                    CORRELATION ENGINE
                             v
              /api/orders/{id}  <->  OrderController.findOne
                                     src/orders/order.controller.ts:42
```

Without a canonical, normalized endpoint vocabulary on both sides, correlation is string-matching against guesswork.

## 2. The inventory is persisted, not transient

`EndpointInventory` is a stored entity with cross-audit history. Three reasons:

1. Correlation needs it during the audit.
2. Regression tracking needs it across audits.
3. **Endpoint drift is itself a finding.** An endpoint that appeared without appearing in the Code Map, or a `/admin/*` route newly exposed on production, is reportable in its own right.

```ts
// derived each audit
inventoryDelta = {
  added:   Endpoint[],   // new since last audit -> review
  removed: Endpoint[],   // gone since last audit -> possible breaking change
  changed: Endpoint[]    // auth requirement or status class changed
}
```

## 3. Tool set

### v1 — included

| Tool | Role | License | Why |
|---|---|---|---|
| **Katana** | Crawling, endpoint discovery | MIT | ProjectDiscovery crawler built for security recon; handles JS-heavy apps, which ordinary crawlers miss |
| **httpx** | HTTP probing and verification | MIT | Confirms discovered URLs are live, captures status, headers, tech fingerprint |
| **Playwright** | Dynamic/browser discovery | Apache-2.0 | Finds routes reachable only through real interaction — SPA navigation, form submission, auth flows |
| **nuclei** | Template-based vulnerability checks | MIT | Deterministic, versioned templates producing **gate-eligible** evidence |
| **OpenAPI ingest** | Spec-based discovery | — | If the target publishes a spec, it is the highest-quality source available |

### v1.1 — deferred

| Tool | Why deferred |
|---|---|
| **gau** | Queries third parties (Wayback, CommonCrawl, OTX). Adds external egress and can return out-of-scope hosts. Valuable, but needs the scope-validator integration in §5 to be mature first. |

### Cut from v1 — `ffuf`

`ffuf` is brute-force content discovery. Against a customer target it is:

- the highest request volume of anything in the set,
- the most likely to trip a WAF or rate limiter,
- the most likely to appear in the customer's logs as an attack,
- the most likely to violate their host's acceptable-use terms,
- the noisiest (soft-404s dominate its output).

"Only when explicitly authorized" is the right instinct, but making that safe requires a hard per-audit authorization gate, a dedicated rate cap, and soft-404 calibration — more machinery than its v1 value justifies. Revisit once the scope validator and rate limiter have production mileage.

**nuclei is the better v1 addition than either gau or ffuf**, because its output is deterministic and therefore allowed to block a release. Discovery breadth that only produces advisory findings is worth less than narrower discovery that produces gate-eligible ones.

## 4. Recon pipeline

```
                    KASE RECON
                        |
      +-----------------+------------------+
      |         |               |          |
      v         v               v          v
  OpenAPI    Katana        Playwright    httpx
  ingest     crawl         interaction   probe
      |         |               |          |
      v         v               v          |
   routes    URLs/forms    JS routes,      |
             /JS assets    auth surfaces   |
      |         |               |          |
      +---------+-------+-------+          |
                        v                  |
                  URL candidate set        |
                        |                  |
                        +---------> scope validator <---+
                                          |
                                    (denied -> logged, dropped)
                                          |
                                          v
                                     httpx verify
                                          |
                                          v
                                  NORMALIZE + MERGE
                                          |
                                          v
                              ENDPOINT INVENTORY
                                          |
                        +-----------------+-----------------+
                        v                                   v
                 Black Box Agent                   Correlation Engine
```

## 5. Every discovered URL re-enters the scope validator

This is a hard rule, not a nicety.

Recon output is **untrusted, tool-generated input**. A crawler follows links; links point outward. A third-party URL source returns whatever it has indexed. Neither respects the engagement's allowlist.

```ts
for (const url of candidateSet) {
  const decision = scopeValidator.check(url)   // host allowlist, denied paths
  if (!decision.allowed) {
    audit.log('scope_denied', { url, reason: decision.reason, source: url.discoveredBy })
    continue    // never probed, never enters inventory
  }
  verified.push(url)
}
```

Discovery must never be a scope-escalation path. The denial log is also useful signal — a high denial count usually means the allowlist is too narrow for the actual application.

## 6. Normalization

Raw URLs become canonical path templates. This is what makes the inventory joinable with the Code Map.

| Raw | Normalized |
|---|---|
| `/api/invoices/123` | `/api/invoices/{id}` |
| `/api/invoices/9f2e-4c1a-...` | `/api/invoices/{id}` |
| `/users/42/orders/7` | `/users/{id}/orders/{id}` |
| `/search?q=foo&page=2` | `/search` + params `[q, page]` |

Rules:

- Numeric segments, UUIDs, ULIDs, hashes, and base64-ish segments become `{id}`.
- Query parameters are extracted into `parameters[]`, not kept in the path.
- Trailing slashes and case are normalized.
- Path templates from OpenAPI or the Code Map are **preferred over inferred ones** when they match; inference is a fallback.
- Raw examples are retained in `Endpoint.rawExamples` because reproductions need concrete URLs.

## 7. Merge strategy

Multiple sources discover the same endpoint. Merge by `(method, pathTemplate)`, union the `discoveredBy` array, and prefer higher-quality attributes:

| Attribute | Preference order |
|---|---|
| `pathTemplate` | OpenAPI > Code Map > Katana inference |
| `parameters` | OpenAPI > observed |
| `requiresAuth` | Observed (401/403 without creds) > inferred |
| `contentType` | httpx observed |

## 8. Rate and volume discipline

Recon is the highest-volume stage of an audit and is where an audit most easily becomes an incident.

| Control | Default |
|---|---|
| Crawl depth | 3 |
| Max pages per target | 500 |
| Requests per second | 10 (from `ScopePolicy`) |
| Concurrent connections | 5 |
| Respect `robots.txt` | Yes on production targets; configurable on staging |
| Total recon request budget | 40% of `max_requests_to_target` |

Rate limiting is enforced **globally per target host**, not per job — two concurrent audits against one staging host must not sum to 2× the agreed RPS.

## 9. ReconAdapter interface

Implements the common adapter contract from [07](../07-tool-adapters/README.md), plus discovery-specific methods.

```ts
interface ReconAdapter extends ToolAdapter {
  discover(target: Target, opts: ReconOptions): Promise<UrlCandidate[]>
  crawl(baseUrl: string, depth: number): Promise<CrawlResult>
  extractLinks(doc: CrawlResult): UrlCandidate[]
  extractEndpoints(doc: CrawlResult): EndpointCandidate[]
  extractForms(doc: CrawlResult): FormCandidate[]
  extractJsResources(doc: CrawlResult): AssetCandidate[]
  collectMetadata(url: string): Promise<HttpMetadata>
  normalizeResults(raw: unknown): EndpointCandidate[]
}
```

## 10. Target Inventory output

The merged, canonical artifact handed to both the black-box agent and the correlation engine:

```
Target Inventory
├── Pages
├── Routes (path templates)
├── API endpoints
├── Forms
├── Parameters
├── JS resources
├── Authentication surfaces
├── Redirects
├── Technologies (fingerprint)
└── HTTP metadata (headers, TLS, status classes)
```

---

**Next:** [07 — Tool Adapters](../07-tool-adapters/README.md)
