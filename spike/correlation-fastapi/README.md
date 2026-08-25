# Correlation Spike — FastAPI

Ports [`spike/correlation`](../correlation/README.md) (NestJS) to FastAPI to answer one question:

> Is the correlation strategy general, or was it quietly NestJS-specific?

**Answer: general.** 11/11 checks, 8/8 in each safety mode, passing on the first run. But the *mechanism* differs in ways that change the design, and those differences are the point of this spike.

---

## Run it

No install needed if `fastapi`, `uvicorn`, and `httpx` are present.

```bash
cd spike/correlation-fastapi && python -m src.spike
```

| Command | Proves |
|---|---|
| `python -m src.spike` | Happy path. One correlated finding, gate blocks. |
| `python -m src.spike --no-commit` | Provenance safety — reported but cannot block. |
| `python -m src.spike --fixed` | Finding clears on remediation. Fixture restored after. |

Real output:

```
CF-9ee08d5f  Resource lookup lacks an ownership predicate
fingerprint  56dfedcc24bb32c5
chain        GET /api/invoices/{invoice_id}  ->  fixture.app.find_one  ->  InvoiceService.find
source       fixture/invoice_service.py:18 (InvoiceService.find)
method       runtime_dump   verified=True
evidence     EV-6f528b79:http_exchange  EV-07cb3289:sast_json
```

---

## What differs from NestJS

### 1. Dependency injection lives somewhere else — but resolves the same way

| | NestJS | FastAPI |
|---|---|---|
| Injection site | constructor parameter | handler parameter |
| Syntax | `constructor(private readonly svc: InvoiceService)` | `svc: InvoiceService = Depends(get_invoice_service)` |
| Resolution key | **declared parameter type** | **declared parameter annotation** |
| Needs type checker? | No | No |

Different location, identical strategy: **the declared type is the resolution key, and it is available syntactically.** No type checker, no import graph, no full compile. That property — which is what makes the code map viable on repos that don't build — survives the port.

This is the core result. The strategy generalizes because both frameworks make developers *declare* what they inject.

### 2. FastAPI's route table is strictly better than Nest's

FastAPI keeps the real function object on every route:

```python
route.endpoint.__qualname__     # 'find_one' — free, no reflection
```

Nest requires reading decorator metadata off the DI container to recover the same information. Both work, but FastAPI needs less machinery. Neither resembles Express, which loses the symbol entirely — reinforcing why Express is last in the sequencing.

### 3. Symbol namespaces are framework-shaped ⚠

This one has a design consequence:

```
NestJS    InvoiceController.findOne     Class.method
FastAPI   fixture.app.find_one          module.function
```

[03 — Data Model](../../docs/03-data-model/README.md) types `handlerSymbol` with the example `'InvoiceController.findOne'`, which implicitly assumes class-based naming. It holds as a string, but **nothing downstream may parse it as `Class.method`** — no splitting on `.` to recover a class name, no assuming two segments. Worth an explicit note in the data model before someone writes that parser.

Fingerprints are unaffected: they hash the symbol opaquely.

### 4. Path parameter names differ for the same logical endpoint ⚠

```
NestJS fixture    /api/invoices/{id}
FastAPI fixture   /api/invoices/{invoice_id}
```

Both correct; both name the same parameter. So **template matching must be name-agnostic** — canonicalize through the route table, never by string-comparing a crawler's output against a route template. `templatize()` does this by regex-matching the observed path against each route, which is why the join works despite the mismatch.

If the endpoint inventory ever keyed on template *strings* across sources, this would silently fail to join. Flagged for M3.

### 5. No decorator-metadata problem

The NestJS spike hit a real snag: `tsx`/esbuild doesn't emit `design:paramtypes`, so Nest's implicit DI silently injected `undefined`. Python has no equivalent — annotations are introspectable at runtime and readable in the AST regardless of how the code is executed.

That failure mode is **JavaScript-toolchain-specific**, not a correlation problem. Confirms the original diagnosis.

---

## What this changes for M5

- Estimate is **more confident, not smaller.** Two frameworks working means the approach is sound; it does not mean the remaining frameworks are free.
- Two concrete additions surfaced, both cheap and both easy to get wrong later:
  - `handlerSymbol` must be treated as an opaque string
  - template matching must be name-agnostic
- Express remains correctly deferred. Both spiked frameworks make developers *declare* injection and *retain* handler identity; Express does neither, which is exactly why it needs the runtime dump rather than a parser.

---

## Deliberate substitutions

Same posture as the NestJS spike — stub what wasn't uncertain, visibly:

| Real system | Here | Why |
|---|---|---|
| Semgrep | `ast`-based rule in `src/sast.py` | Emits the same fields the join consumes. Matches the idiomatic SQLAlchemy `filter_by()` shape, not an invented one. |
| Black-box agent | Hard-coded IDOR probe | Agent loop is M4's risk, not M5's. |
| SQLAlchemy + Postgres | In-memory session with the same query interface | The AST rule matches real ORM idiom; a database proves nothing here. |
| Katana | Route dump doubles as inventory | Recon is M3 and independently low-risk. |

The probe runs **real HTTP against real uvicorn** on an ephemeral port rather than FastAPI's `TestClient` — an in-process client would skip the middleware and serialization path a real client goes through, which is precisely what a black-box probe is supposed to exercise.

---

## Layout

```
fixture/
  invoice_service.py   <- the seeded IDOR (line 18)
  app.py               <- routes; NOT where the bug is, on purpose
  db.py                in-memory, SQLAlchemy-shaped
src/
  routemap.py    layer 1 — FastAPI app.routes -> RouteMapping[]
  codemap.py     handler -> service via Depends annotations
  sast.py        Semgrep-equivalent AST rule
  blackbox.py    uvicorn harness, IDOR probe, replay, provenance
  correlate.py   THE JOIN + fingerprinting
  spike.py       orchestrator and assertions
```
