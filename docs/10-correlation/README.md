# 10 — Correlation Engine

The nervous system. Links what was observed from outside to the source that causes it.

---

## 1. What correlation produces

```
Black box:  GET /api/invoices/123 returns another user's invoice
                              |
                    Endpoint Inventory
                    /api/invoices/{id}
                              |
                       Route Mapping
              InvoiceController.findOne (runtime dump)
                              |
White box:  InvoiceService.find — lookup lacks ownership predicate
                              |
                    ONE CORRELATED FINDING
            external reproduction + exact source location
            both evidence artifacts preserved
```

This is the product's differentiator. It is also the part most easily made *confidently wrong*, which §2 exists to prevent.

## 2. Build provenance binding

**Correlation is only meaningful when the deployment and the checkout are the same build.**

The audit probes a running system. It parses a repository checkout. If those are different builds, correlation still produces a plausible-looking `file:line` — and a wrong source location is worse than no source location, because it sends an engineer to the wrong place with false confidence.

Every audit therefore resolves `BuildProvenance` before any agent runs.

### Resolution order

| Priority | Source | `verified` | How |
|---|---|---|---|
| 1 | `ci_supplied` | true | CI passes `--commit <sha>`; highest trust, the build system knows |
| 2 | `build_info_endpoint` | true | `Target.buildInfoUrl` returns the deployed SHA |
| 3 | `response_header` | true | e.g. `X-Build-SHA` on any response |
| 4 | `assumed` | **false** | Fall back to default-branch HEAD |

### Consequence of unverified provenance

When `verified === false`:

- the audit continues normally,
- every `Correlation` is written with `verified: false`,
- every correlated finding is **non-gate-eligible**,
- the report, dashboard, and CI output carry an explicit warning — not a footnote.

### Corroboration

Even with a claimed SHA, Kase computes a `targetFingerprint` — a hash over observed static asset digests, build manifests, and any exposed version string. A mismatch against the checkout's expected assets downgrades `verified` to false and logs the discrepancy. Cheap, and it catches "staging says it is on `main` but was deployed four days ago."

## 3. Layer 1 — Deterministic mapping

Deterministic sources are ranked. Static parsing is the *last* deterministic option, not the first.

```
1. Runtime route dump    highest fidelity
2. OpenAPI specification
3. Static route parsing
4. AI inference          advisory only, see §5
```

### 3.1 Runtime route dump (preferred)

Nearly every framework can enumerate its own routes at runtime, and doing so gives ground truth rather than an approximation:

| Framework | Mechanism |
|---|---|
| NestJS | `RouterExplorer` / `app.getHttpAdapter().getInstance()._router` |
| Express | `app._router.stack` walk |
| FastAPI | `app.routes` |
| Django | `get_resolver().url_patterns` |
| Spring Boot | `RequestMappingHandlerMapping.getHandlerMethods()` |
| Rails | `Rails.application.routes.routes` |

Kase ships a small opt-in `kase-routemap` command the project can run in CI, emitting a JSON route map committed as a build artifact. This costs the customer minutes and eliminates the hardest problem in the engine.

```json
{
  "framework": "nestjs",
  "commit": "a3f9c1e",
  "routes": [
    {
      "method": "GET",
      "path": "/api/invoices/:id",
      "handler": "InvoiceController.findOne",
      "file": "src/invoices/invoice.controller.ts",
      "line": 84,
      "middleware": ["AuthGuard"]
    }
  ]
}
```

### 3.2 OpenAPI

If the project publishes a spec, it is authoritative for path templates and parameters, though it usually does not name handlers. Combines well with static parsing: OpenAPI supplies the template, static parsing supplies the symbol.

### 3.3 Static route parsing

Per-framework parsers, in implementation order:

| Framework | Difficulty | Approach |
|---|---|---|
| **NestJS** | Low | Decorators are statically analysable; `@Controller` + `@Get` compose predictably |
| **FastAPI** | Low | Decorators, explicit paths |
| **Django** | Medium | `urls.py` with nested `include()` resolution |
| **Express** | **High** | See below |

**Express is the hardest and must not be the first parser built.** Dynamic `app.use(router)`, route factories, conditionally mounted middleware, and prefix composition at runtime all defeat static analysis. Express is precisely the case that *requires* the runtime dump. Build NestJS and FastAPI first — decorator-based frameworks are statically tractable and prove the pipeline.

### 3.4 Symbol resolution

Whichever source produced the mapping, the engine resolves the **enclosing symbol** (`InvoiceController.findOne`), not just a line number, because that is what the fingerprint uses ([09 §4](../09-findings/README.md#4-fingerprinting)).

It also walks one level deeper — controller to service to repository — so a finding whose root cause sits in `InvoiceService.find` is attributed there rather than to the controller that merely calls it.

## 4. Layer 2 — Execution evidence

Runtime signals collected during black-box execution, used to sharpen or confirm a mapping.

| Signal | Availability | Value |
|---|---|---|
| URL + method | Always | Primary join key |
| **Request ID header** | Only with target cooperation | **Strongest signal available** |
| Response headers | Always | Framework and version fingerprint |
| Console errors | Browser jobs | Client-side module hints |
| Network trace | Browser jobs | Reveals XHR endpoints not crawled |
| Stack trace | Rare | See below |

### Request-ID correlation is the strong version

If the target emits a request ID (`X-Request-Id`) and Kase can read the application's logs for the audit window, findings join to server-side execution directly — the actual handler, the actual query, the actual error. That is a *much* stronger correlation than route-map inference.

It requires target cooperation, so name it honestly:

| Mode | Requirement | Correlation quality |
|---|---|---|
| **Instrumented** | Route dump + request-ID header + log access | High; direct handler attribution |
| **Uninstrumented** | Nothing | Best-effort; route-map inference only |

Selling that distinction plainly is better than implying correlation quality is uniform. Instrumented mode is also a natural expansion path in the product.

### Do not build on stack traces

Stack traces are only available on unhandled 500s, and only if the target leaks them — which is itself a finding Kase would be reporting. Useful when present, never a dependency.

## 5. Layer 3 — Code map

The white-box agent produces a structured Code Map, persisted per audit.

```
Route
├── method
├── path template
├── middleware[]
├── controller symbol + file
├── handler symbol + line
├── service symbols[]
├── repository symbols[]
└── data access sites[]
```

The Code Map serves correlation and doubles as the **context-selection index** for the AI layer — it is how Kase sends relevant code rather than the whole repository ([11 §4](../11-ai-layer/README.md#4-context-strategy)).

## 6. Layer 4 — AI inference

Used **only** where deterministic mapping fails to establish a relationship.

### Contract

```json
{
  "confidence_band": "high",
  "candidate_source": {
    "file": "src/invoices/invoice.controller.ts",
    "enclosing_symbol": "InvoiceController.findOne",
    "line": 84
  },
  "rationale": "Only handler matching GET /api/invoices/{id}; performs a findUnique by id with no ownership predicate.",
  "alternatives_considered": [
    {
      "file": "src/invoices/invoice.admin.controller.ts",
      "enclosing_symbol": "InvoiceAdminController.findOne",
      "rejected_because": "Mounted under /admin, guarded by RolesGuard"
    }
  ]
}
```

`rationale` and `alternatives_considered` are **required**. A candidate with no rejected alternatives is treated as low confidence — if the model saw no alternatives, it did not search.

### Rules

- AI correlation is **advisory**. It never silently becomes fact.
- `confidence_band`, never a float. See [09 §7](../09-findings/README.md#7-confidence-is-a-band-not-a-number).
- AI-inferred correlations are **not gate-eligible** ([09 §8](../09-findings/README.md#8-gate-eligibility)). They inform engineers; they do not block releases.
- Every AI correlation is labelled as such in the UI, the report, and the Jira issue.

## 7. Method ranking

| Method | Band | Gate-eligible |
|---|---|---|
| `request_id` | high | Yes |
| `runtime_dump` | high | Yes |
| `openapi` | high | Yes |
| `static_parse` | medium | Yes |
| `ai_inference` | low | **No** |

All subject to `BuildProvenance.verified === true`. Unverified provenance downgrades everything to non-gate-eligible regardless of method.

## 8. Algorithm

```
for each blackbox finding B:
  1. resolve B.affectedTarget -> Endpoint (inventory, normalized template)
     miss -> no correlation, done

  2. resolve Endpoint -> RouteMapping
     try request_id -> runtime_dump -> openapi -> static_parse
     miss -> go to 5

  3. collect candidate symbols: handler, services, repositories, data-access sites

  4. match against whitebox findings W where
       W.sourceLocation.enclosingSymbol in candidates
       AND categories are compatible (authz~authz_logic, security~static_security)
     hit -> Correlation(method = mapping source, verified = provenance.verified)
     done

  5. AI inference over the Code Map, scoped to plausible candidates only
     -> Correlation(method='ai_inference', band='low', gateEligible=false)
```

### Category compatibility

Correlation is not allowed across unrelated categories — a performance finding must not correlate to an authz finding merely because they share a route.

| Black box | Compatible white box |
|---|---|
| `authz` | `authz_logic`, `static_security` |
| `authn` | `authz_logic`, `secrets` |
| `security` | `static_security`, `input_validation`, `dependencies` |
| `api_surface` | `input_validation`, `error_handling` |
| `performance` | `code_quality` |

## 9. Failure modes and mitigations

| Failure | Mitigation |
|---|---|
| Deployment ≠ checkout | `BuildProvenance`, asset corroboration, `verified` flag |
| Route not in inventory | Endpoint drift reported as its own finding |
| Dynamic routes (Express) | Runtime dump; static parse marked lower confidence |
| Reverse proxy rewrites path | Path prefix mapping configurable on `Target` |
| Monorepo, multiple services | Repository is registered per service; correlation is scoped to the owning service |
| Handler found, root cause deeper | Walk controller → service → repository; attribute to the deepest matching symbol |
| Multiple plausible handlers | `alternatives_considered` required; ambiguity yields `low` band |

---

**Next:** [11 — AI Layer](../11-ai-layer/README.md)
