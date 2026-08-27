import 'reflect-metadata';
import * as path from 'path';
import * as fs from 'fs';
import { dumpRoutes } from './routemap';
import { CodeMap } from './codemap';
import { runSast } from './sast';
import { probeIdor, replay, resolveProvenance } from './blackbox';
import { correlate } from './correlate';
import { BuildProvenance } from './types';

/**
 * The fixture lives at the repo root (fixtures/vulnerable-app), shared with
 * docker-compose, rather than inside this spike. Analysis is rooted at the
 * fixture's OWN tsconfig so reported paths stay clean — `invoices/…` rather
 * than a chain of `../../..` — which also keeps fingerprints readable.
 */
const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'vulnerable-app');
const TSCONFIG = path.join(FIXTURE_DIR, 'tsconfig.json');
const COMMIT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

const args = process.argv.slice(2);
const noCommit = args.includes('--no-commit');
const fixed = args.includes('--fixed');

// ---------- console helpers ----------
const BOLD = '\x1b[1m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const ok = (s: string) => `${GREEN}PASS${RESET} ${s}`;
const bad = (s: string) => `${RED}FAIL${RESET} ${s}`;

function step(n: number, label: string) {
  console.log(`\n${BOLD}${CYAN}[${n}]${RESET} ${BOLD}${label}${RESET}`);
}

/**
 * `--fixed` applies the real one-token remediation to the controller:
 *   this.invoiceService.find(...)  ->  this.invoiceService.findScoped(...)
 *
 * This is what a developer would actually commit, and it exercises something
 * worth proving: after the fix, `InvoiceService.find` is still flagged by the
 * static rule but is no longer REACHABLE from the route, so it must not
 * correlate and must not block. Reachability is load-bearing, not decorative.
 */
const CONTROLLER = path.join(FIXTURE_DIR, 'invoices', 'invoice.controller.ts');

function applyFix(): string {
  const original = fs.readFileSync(CONTROLLER, 'utf8');
  const patched = original.replace(
    'this.invoiceService.find(id, requesterId)',
    'this.invoiceService.findScoped(id, requesterId)',
  );
  if (patched === original) throw new Error('--fixed: patch target not found in controller');
  fs.writeFileSync(CONTROLLER, patched, 'utf8');
  return original;
}

function restore(original: string | null) {
  if (original !== null) fs.writeFileSync(CONTROLLER, original, 'utf8');
}

const checks: { name: string; passed: boolean; detail: string }[] = [];
function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
  console.log(`    ${passed ? ok(name) : bad(name)}`);
  if (detail) console.log(`         ${DIM}${detail}${RESET}`);
}

async function main() {
  console.log(`${BOLD}Kase — correlation spike${RESET}`);
  console.log(`${DIM}Proves: black-box IDOR -> route -> source symbol -> one correlated finding${RESET}`);
  if (noCommit) console.log(`${YELLOW}mode: --no-commit (provenance safety check)${RESET}`);
  if (fixed)    console.log(`${YELLOW}mode: --fixed (vulnerability remediated)${RESET}`);

  // Patch before anything reads the source: Nest compiles it on import and
  // ts-morph reads it from disk.
  let originalController: string | null = null;
  if (fixed) {
    originalController = applyFix();
    console.log(`${DIM}applied fix: InvoiceController.findOne now calls findScoped()${RESET}`);
  }

  // ---------------------------------------------------------------- 1
  step(1, 'Boot fixture target');
  const { bootFixture } = await import('../../../fixtures/vulnerable-app/main');
  const fixture = await bootFixture(noCommit ? undefined : COMMIT);
  console.log(`    ${DIM}listening on ${fixture.baseUrl}${RESET}`);

  try {
    // -------------------------------------------------------------- 2
    step(2, 'Resolve build provenance');
    const resolved = await resolveProvenance(fixture.baseUrl, noCommit ? null : COMMIT);
    const provenance: BuildProvenance = {
      commitSha: resolved.commitSha,
      source: resolved.source,
      verified: resolved.verified,
    };
    console.log(`    source=${provenance.source} verified=${provenance.verified}`);
    console.log(`    ${DIM}commit=${provenance.commitSha ?? '(none)'}${RESET}`);

    // -------------------------------------------------------------- 3
    step(3, 'Route dump (layer 1, deterministic)');
    const routes = dumpRoutes(fixture.app);
    for (const r of routes) {
      console.log(`    ${r.method.padEnd(4)} ${r.pathTemplate.padEnd(24)} -> ${r.handlerSymbol}  ${DIM}[${r.source}]${RESET}`);
    }
    const invoiceRoute = routes.find((r) => r.pathTemplate === '/api/invoices/{id}');
    check(
      'route dump resolves the parameterized route to a handler symbol',
      invoiceRoute?.handlerSymbol === 'InvoiceController.findOne',
      `got: ${invoiceRoute?.handlerSymbol ?? 'none'}`,
    );

    // -------------------------------------------------------------- 4
    step(4, 'Code map walk (controller -> service)');
    const codeMap = new CodeMap(TSCONFIG);
    const entries = codeMap.buildForRoutes(routes);
    const entry = entries.get('InvoiceController.findOne');
    if (entry) {
      console.log(`    handler  ${entry.handlerSymbol}  ${DIM}${entry.handlerLocation.file}:${entry.handlerLocation.line}${RESET}`);
      for (const edge of entry.chain) {
        console.log(`      -> via this.${edge.via}  ${edge.toSymbol}  ${DIM}${edge.location.file}:${edge.location.line}${RESET}`);
      }
    }
    // Under --fixed the handler calls findScoped, so that is the symbol the
    // walk must reach. The property under test is "the walk resolves the
    // service method the controller actually calls", not a fixed name.
    const expectedServiceSymbol = fixed ? 'InvoiceService.findScoped' : 'InvoiceService.find';
    check(
      `code map walks past the controller into the service (${expectedServiceSymbol})`,
      !!entry?.reachableSymbols.includes(expectedServiceSymbol),
      `reachable: ${entry?.reachableSymbols.join(', ') ?? 'none'}`,
    );

    // -------------------------------------------------------------- 5
    step(5, 'White-box scan');
    const whitebox = runSast(TSCONFIG);
    for (const f of whitebox) {
      const loc = f.sourceLocations[0];
      console.log(`    ${f.ruleId}`);
      console.log(`      ${loc.file}:${loc.line}  ${BOLD}${loc.enclosingSymbol}${RESET}`);
    }
    const vulnFinding = whitebox.find((f) =>
      f.sourceLocations.some((l) => l.enclosingSymbol === 'InvoiceService.find'),
    );
    check(
      'static rule flags the unscoped lookup at the service, not the controller',
      !!vulnFinding,
      vulnFinding ? `${vulnFinding.sourceLocations[0].enclosingSymbol}` : 'not found',
    );
    check(
      'the fixed variant is NOT flagged',
      !whitebox.some((f) => f.sourceLocations.some((l) => l.enclosingSymbol === 'InvoiceService.findScoped')),
      'findScoped constrains on ownerId, so the rule correctly ignores it',
    );

    // -------------------------------------------------------------- 6
    step(6, 'Black-box probe (two accounts)');
    const owner    = { userId: 'user_alice', token: 'tok_alice', ownedInvoiceId: 'inv_1001' };
    const attacker = { userId: 'user_bob',   token: 'tok_bob',   ownedInvoiceId: 'inv_1002' };
    console.log(`    ${DIM}bob requests alice's invoice inv_1001${RESET}`);

    const { finding: bbFinding, exchange } = await probeIdor(fixture.baseUrl, owner, attacker);
    console.log(`    HTTP ${exchange.response.status}  ${DIM}${exchange.response.body.slice(0, 90)}${RESET}`);
    check(
      fixed
        ? 'black-box probe correctly observes NO cross-user read after the fix'
        : 'black-box probe observes the cross-user read',
      fixed ? !bbFinding : !!bbFinding,
      bbFinding
        ? `${bbFinding.id} — ${bbFinding.title}`
        : `HTTP ${exchange.response.status} — non-owner denied`,
    );

    // -------------------------------------------------------------- 7
    step(7, 'Correlate');
    const { correlated, uncorrelated } = correlate(
      bbFinding ? [bbFinding] : [],
      whitebox,
      routes,
      entries,
      provenance,
    );

    const cf = correlated[0];
    if (cf) {
      console.log(`    ${BOLD}${cf.id}${RESET}  ${cf.title}`);
      console.log(`    fingerprint  ${cf.fingerprint}`);
      console.log(`    chain        ${cf.correlation.chainDescription}`);
      console.log(`    source       ${BOLD}${cf.sourceLocation.file}:${cf.sourceLocation.line}${RESET} (${cf.sourceLocation.enclosingSymbol})`);
      console.log(`    method       ${cf.correlation.method}   verified=${cf.correlation.verified}`);
      console.log(`    evidence     ${cf.evidence.map((e) => `${e.id}:${e.type}`).join('  ')}`);
    } else {
      console.log(`    ${DIM}no correlated finding${RESET}`);
    }
    console.log(`    ${DIM}uncorrelated: ${uncorrelated.length}${RESET}`);

    // -------------------------------------------------------------- 8
    step(8, 'Gate');
    let exitCode = 0;

    if (cf) {
      const reproduced = await replay(exchange);
      console.log(`    replay reproduces: ${reproduced}`);
      const blocks = cf.gateEligible && reproduced;
      console.log(`    ${blocks ? `${RED}${BOLD}BLOCK${RESET}` : `${YELLOW}WARN${RESET}`}  ${cf.gateReason}`);
      if (blocks) exitCode = 1;
    } else {
      console.log(`    ${GREEN}${BOLD}PASS${RESET}  no gate-eligible finding`);
    }

    // ---------------------------------------------------------- assertions
    step(9, 'Spike assertions');

    if (fixed) {
      check('FIXED MODE: no correlated finding survives', correlated.length === 0,
        'the black-box probe no longer observes a leak');
      check('FIXED MODE: exit code is 0', exitCode === 0, `exit=${exitCode}`);
      // The vulnerable method still EXISTS and is still flagged statically —
      // it is just no longer reachable from any route. It must not correlate
      // and must not block. This is why reachability is part of the join.
      check('FIXED MODE: stale static finding on unreachable code does not correlate',
        whitebox.some((f) => f.sourceLocations.some((l) => l.enclosingSymbol === 'InvoiceService.find'))
          && correlated.length === 0,
        'InvoiceService.find is still flagged but is now dead code — correctly not gated');
    } else if (noCommit) {
      check('UNVERIFIED MODE: correlation still produced', correlated.length === 1,
        'the finding is still reported — it is just not allowed to block');
      check('UNVERIFIED MODE: correlation marked unverified', cf?.correlation.verified === false,
        `verified=${cf?.correlation.verified}`);
      check('UNVERIFIED MODE: does NOT block the build', exitCode === 0,
        'safety property: unverified provenance must never fail a build');
    } else {
      check('exactly one correlated finding', correlated.length === 1,
        `got ${correlated.length}`);
      check('points at InvoiceService.find, NOT the controller',
        cf?.sourceLocation.enclosingSymbol === 'InvoiceService.find',
        `got ${cf?.sourceLocation.enclosingSymbol}`);
      check('correlation method is runtime_dump', cf?.correlation.method === 'runtime_dump',
        `got ${cf?.correlation.method}`);
      check('correlation verified against build provenance', cf?.correlation.verified === true,
        `verified=${cf?.correlation.verified}`);
      check('both evidence artifacts preserved', cf?.evidence.length === 2,
        `${cf?.evidence.map((e) => e.type).join(' + ')}`);
      check('gate blocks the build', exitCode === 1, `exit=${exitCode}`);
    }

    // ---------------------------------------------------------- summary
    const failed = checks.filter((c) => !c.passed);
    console.log(`\n${BOLD}${'-'.repeat(64)}${RESET}`);
    if (failed.length === 0) {
      console.log(`${GREEN}${BOLD}SPIKE PASSED${RESET}  ${checks.length}/${checks.length} checks`);
    } else {
      console.log(`${RED}${BOLD}SPIKE FAILED${RESET}  ${failed.length}/${checks.length} checks failed`);
      for (const f of failed) console.log(`  ${RED}x${RESET} ${f.name} — ${f.detail}`);
    }
    console.log(`${DIM}gate exit code would be: ${exitCode}${RESET}`);

    await fixture.close();
    restore(originalController);
    // Set exitCode rather than calling process.exit(): an immediate exit
    // while libuv is still closing the server handle trips an assertion
    // on Windows. Let the loop drain naturally.
    process.exitCode = failed.length === 0 ? 0 : 2;
  } catch (err) {
    await fixture.close();
    restore(originalController);
    throw err;
  }
}

main().catch((err) => {
  console.error('\nspike crashed:', err);
  process.exitCode = 3;
});
