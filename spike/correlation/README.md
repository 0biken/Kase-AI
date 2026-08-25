# Correlation Spike

Proves the Kase thesis end to end on one seeded vulnerability, with no platform around it:

```
black-box IDOR  ->  route  ->  source symbol  ->  white-box finding  ->  ONE correlated finding  ->  gate
```

**Status: passing.** 11/11 checks in default mode, 8/8 in each safety mode.

This exists because [19 — Roadmap](../../docs/19-roadmap/README.md) puts correlation at M5, week 15. Correlation is the least certain part of the design and the part everything else assumes works. Three days here beats discovering a flaw in month four.

---

## Run it

```bash
cd spike/correlation && npm install
```

```bash
npm run spike
```

| Command | Proves |
|---|---|
| `npm run spike` | The happy path. One correlated finding, gate blocks, exit 1. |
| `npm run spike:unverified` | **Safety.** No commit SHA → correlation still reported but marked unverified and *cannot* block. |
| `npm run spike:fixed` | **Regression.** Applies the real one-token fix → finding clears, gate passes. Source is restored afterward. |

The spike's own exit code is 0 when its assertions pass. The *simulated gate* exit code is printed separately — that's the number a CI run would see.

---

## What it actually does

```
[1] Boot fixture           in-process NestJS on an ephemeral port
[2] Build provenance       CI-supplied SHA vs. /healthz  -> verified: true
[3] Route dump             Nest DI metadata  -> /api/invoices/{id} = InvoiceController.findOne
[4] Code map walk          findOne --this.invoiceService--> InvoiceService.find
[5] White-box scan         AST rule flags the unscoped Prisma lookup
[6] Black-box probe        Bob requests Alice's invoice -> HTTP 200 + record body
[7] Correlate              join on enclosing symbol -> ONE finding, both artifacts
[8] Gate                   replay reproduces + provenance verified -> BLOCK
```

Real output from step 7:

```
CF-db7beb5b  Resource lookup lacks an ownership predicate
fingerprint  7be77d6a8cca514e
chain        GET /api/invoices/{id}  ->  InvoiceController.findOne  ->  InvoiceService.find
source       fixture/invoices/invoice.service.ts:17 (InvoiceService.find)
method       runtime_dump   verified=true
evidence     EV-a73c224b:http_exchange  EV-b97bcb2f:sast_json
```

---

## What this proved

**1. The route dump gives you the handler symbol; Express's router does not.**

Nest's decorator metadata (`PATH_METADATA` / `METHOD_METADATA`, read off the live DI container) yields `InvoiceController.findOne` directly. Parsing Express's `_router.stack` gives you the path but only an anonymous bound function — the symbol is gone, and the symbol is the entire join key. This is concrete support for the docs' ordering: **runtime dump > OpenAPI > static parse**.

**2. The controller→service walk is the load-bearing hop, and it's tractable.**

The bug is in `InvoiceService.find`, not in the controller the route resolves to. A correlation that stops at the handler points reviewers at the wrong file. Resolving `this.invoiceService` → `InvoiceService` via the constructor's declared parameter type is **purely syntactic** — no type checker, no full compile. That makes it fast and robust on partial or non-compiling codebases, which matters for auditing repos you don't control.

**3. Reachability has to be part of the join.**

Best result from `--fixed`: after the fix, `InvoiceService.find` still exists and is *still flagged by the static rule* — but it's dead code, unreachable from any route. It correctly does not correlate and does not block. A design that joined on file/symbol alone, without reachability, would fail a build over dead code.

**4. Symbol-keyed fingerprints survive edits; line-keyed ones would not.**

Adding the `@Inject` decorator shifted the handler from line 16 to line 21. The fingerprint (`7be77d6a8cca514e`) was unchanged — it keys on `InvoiceService.find`, not a line number. This is [ADR-004](../../docs/20-adr/README.md) demonstrated by accident, which is the best way to demonstrate it.

**5. The provenance safety property holds.**

`--no-commit` still finds and reports the vulnerability. It just refuses to let it block a build, because an unverified target/source binding means the source location may be wrong. Reported, not gated.

---

## Deliberate substitutions

The spike proves the **correlation path**. Where a component was not the uncertain part, it's stubbed — honestly and visibly:

| Real system | Here | Why |
|---|---|---|
| Semgrep (`docs/07 §4.8`) | ts-morph AST rule in `src/sast.ts` | Semgrep is Python and not installed. The rule emits the **same fields** — `ruleId`, `cwe`, file, line, enclosing symbol — because those are what the join and fingerprint consume. Semgrep's accuracy was never in doubt; the join was. |
| Black-box agent (`docs/05`) | Hard-coded IDOR probe | The agent loop is M4's risk, not M5's. Hard-coding keeps correlation under test. |
| Postgres + Prisma | In-memory store, Prisma call shape | The AST rule matches real `findUnique({ where })` syntax. A database proves nothing here. |
| Docker Compose | In-process boot on port 0 | No Docker locally, and the spike is faster without it. |
| Katana crawl | Route dump doubles as inventory | Recon is M3 and independently low-risk. |

**Known gap:** only NestJS. FastAPI is the next framework to try, and Express is deliberately last — it's the case that most needs the runtime dump, per the docs' own sequencing.

---

## One real problem found

`tsx` uses esbuild, which does not emit `design:paramtypes`. Nest's implicit constructor DI silently produced `undefined` for the injected service — a 500 at runtime, not a build error.

Worked around with an explicit `@Inject(InvoiceService)`, annotated in the fixture. **This is a runner artifact, not a design finding** — real Nest apps compiled by `tsc` emit the metadata correctly. It does not touch the code map, which reads the declared parameter *type* syntactically and never consults runtime metadata.

Worth flagging for M1: if the build tooling ever moves to esbuild/SWC, decorator metadata needs explicit configuration.

---

## Layout

```
fixture/                          the deliberately vulnerable target
  invoices/invoice.service.ts     <- the seeded IDOR (line 17)
  invoices/invoice.controller.ts  <- NOT where the bug is, on purpose
  health.controller.ts            <- build-info endpoint (ADR-003)
  db.ts                           in-memory, Prisma-shaped
src/
  routemap.ts    layer 1 — Nest metadata -> RouteMapping[]
  codemap.ts     controller -> service walk via constructor types
  sast.ts        Semgrep-equivalent AST rule
  blackbox.ts    IDOR probe, replay, provenance resolution
  correlate.ts   THE JOIN + fingerprinting
  spike.ts       orchestrator and assertions
```

Module boundaries mirror the real subsystems in `docs/`, so what was learned here transfers rather than being thrown away.
