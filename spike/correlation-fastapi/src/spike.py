"""
Kase — correlation spike, FastAPI.

Mirrors spike/correlation (NestJS) to test whether the correlation strategy
holds across frameworks, or whether it was quietly NestJS-specific.

    python -m src.spike
    python -m src.spike --no-commit
    python -m src.spike --fixed
"""

import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from src.blackbox import FixtureServer, ProbeAccount, probe_idor, replay, resolve_provenance  # noqa: E402
from src.codemap import CodeMap  # noqa: E402
from src.correlate import correlate  # noqa: E402
from src.routemap import dump_routes  # noqa: E402
from src.sast import run_sast  # noqa: E402

COMMIT = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
CONTROLLER = os.path.join(ROOT, "fixture", "app.py")

args = sys.argv[1:]
NO_COMMIT = "--no-commit" in args
FIXED = "--fixed" in args

BOLD, DIM, RESET = "\033[1m", "\033[2m", "\033[0m"
RED, GREEN, YELLOW, CYAN = "\033[31m", "\033[32m", "\033[33m", "\033[36m"

checks: list[tuple[str, bool, str]] = []


def step(n: int, label: str) -> None:
    print(f"\n{BOLD}{CYAN}[{n}]{RESET} {BOLD}{label}{RESET}")


def check(name: str, passed: bool, detail: str = "") -> None:
    checks.append((name, passed, detail))
    tag = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    print(f"    {tag} {name}")
    if detail:
        print(f"         {DIM}{detail}{RESET}")


def apply_fix() -> str:
    """
    --fixed applies the real one-token remediation:
        service.find(...)  ->  service.find_scoped(...)

    After the fix InvoiceService.find still exists and is still flagged
    statically, but is no longer REACHABLE from any route. It must not
    correlate and must not block.
    """
    original = open(CONTROLLER, encoding="utf-8").read()
    patched = original.replace(
        "service.find(invoice_id, requester_id)",
        "service.find_scoped(invoice_id, requester_id)",
    )
    if patched == original:
        raise RuntimeError("--fixed: patch target not found in fixture/app.py")
    open(CONTROLLER, "w", encoding="utf-8").write(patched)
    return original


def restore(original: str | None) -> None:
    if original is not None:
        open(CONTROLLER, "w", encoding="utf-8").write(original)


def main() -> int:
    print(f"{BOLD}Kase — correlation spike (FastAPI){RESET}")
    print(f"{DIM}Proves: black-box IDOR -> route -> source symbol -> one correlated finding{RESET}")
    if NO_COMMIT:
        print(f"{YELLOW}mode: --no-commit (provenance safety check){RESET}")
    if FIXED:
        print(f"{YELLOW}mode: --fixed (vulnerability remediated){RESET}")

    original = None
    if FIXED:
        original = apply_fix()
        print(f"{DIM}applied fix: find_one now calls service.find_scoped(){RESET}")

    if not NO_COMMIT:
        os.environ["FIXTURE_COMMIT_SHA"] = COMMIT
    else:
        os.environ.pop("FIXTURE_COMMIT_SHA", None)

    # Import AFTER patching so the running app reflects the fix.
    fixture_app = importlib.import_module("fixture.app")
    importlib.reload(fixture_app)

    step(1, "Boot fixture target")
    server = FixtureServer(fixture_app.app)
    server.start()
    print(f"    {DIM}listening on {server.base_url}{RESET}")

    try:
        step(2, "Resolve build provenance")
        provenance = resolve_provenance(server.base_url, None if NO_COMMIT else COMMIT)
        print(f"    source={provenance['source']} verified={provenance['verified']}")
        print(f"    {DIM}commit={provenance['commit_sha'] or '(none)'}{RESET}")

        step(3, "Route dump (layer 1, deterministic)")
        routes = dump_routes(fixture_app.app)
        for r in routes:
            print(f"    {r.method:<4} {r.path_template:<28} -> {r.handler_symbol}  {DIM}[{r.source}]{RESET}")
        invoice_route = next(
            (r for r in routes if r.path_template == "/api/invoices/{invoice_id}"), None
        )
        check(
            "route dump resolves the parameterized route to a handler symbol",
            invoice_route is not None and invoice_route.handler_function == "find_one",
            f"got: {invoice_route.handler_symbol if invoice_route else 'none'}",
        )

        step(4, "Code map walk (handler -> service via Depends)")
        code_map = CodeMap(ROOT)
        entries = code_map.build_for_routes(routes)
        entry = entries.get(invoice_route.handler_symbol) if invoice_route else None
        if entry:
            print(f"    handler  {entry.handler_symbol}  {DIM}{entry.handler_location.file}:{entry.handler_location.line}{RESET}")
            for edge in entry.chain:
                print(f"      -> via {edge.via}  {edge.to_symbol}  {DIM}{edge.location.file}:{edge.location.line}{RESET}")
        expected_symbol = "InvoiceService.find_scoped" if FIXED else "InvoiceService.find"
        check(
            f"code map follows the Depends annotation into the service ({expected_symbol})",
            entry is not None and expected_symbol in entry.reachable_symbols,
            f"reachable: {', '.join(entry.reachable_symbols) if entry else 'none'}",
        )

        step(5, "White-box scan")
        whitebox = run_sast(ROOT)
        for f in whitebox:
            loc = f.source_locations[0]
            print(f"    {f.rule_id}")
            print(f"      {loc.file}:{loc.line}  {BOLD}{loc.enclosing_symbol}{RESET}")
        check(
            "static rule flags the unscoped lookup at the service, not the handler",
            any(
                loc.enclosing_symbol == "InvoiceService.find"
                for f in whitebox
                for loc in f.source_locations
            ),
            "InvoiceService.find",
        )
        check(
            "the fixed variant is NOT flagged",
            not any(
                loc.enclosing_symbol == "InvoiceService.find_scoped"
                for f in whitebox
                for loc in f.source_locations
            ),
            "find_scoped constrains on owner_id, so the rule correctly ignores it",
        )

        step(6, "Black-box probe (two accounts)")
        owner = ProbeAccount("user_alice", "tok_alice", "inv_1001")
        attacker = ProbeAccount("user_bob", "tok_bob", "inv_1002")
        print(f"    {DIM}bob requests alice's invoice inv_1001{RESET}")
        bb_finding, exchange = probe_idor(server.base_url, owner, attacker)
        print(f"    HTTP {exchange.response['status']}  {DIM}{exchange.response['body'][:88]}{RESET}")
        check(
            "black-box probe correctly observes NO cross-user read after the fix"
            if FIXED
            else "black-box probe observes the cross-user read",
            (not bb_finding) if FIXED else bool(bb_finding),
            f"{bb_finding.id} — {bb_finding.title}"
            if bb_finding
            else f"HTTP {exchange.response['status']} — non-owner denied",
        )

        step(7, "Correlate")
        correlated, uncorrelated = correlate(
            [bb_finding] if bb_finding else [], whitebox, routes, entries, provenance
        )
        cf = correlated[0] if correlated else None
        if cf:
            print(f"    {BOLD}{cf.id}{RESET}  {cf.title}")
            print(f"    fingerprint  {cf.fingerprint}")
            print(f"    chain        {cf.correlation.chain_description}")
            print(f"    source       {BOLD}{cf.source_location.file}:{cf.source_location.line}{RESET} ({cf.source_location.enclosing_symbol})")
            print(f"    method       {cf.correlation.method}   verified={cf.correlation.verified}")
            print(f"    evidence     {'  '.join(f'{e.id}:{e.type}' for e in cf.evidence)}")
        else:
            print(f"    {DIM}no correlated finding{RESET}")
        print(f"    {DIM}uncorrelated: {len(uncorrelated)}{RESET}")

        step(8, "Gate")
        gate_exit = 0
        if cf:
            reproduced = replay(exchange)
            print(f"    replay reproduces: {reproduced}")
            blocks = cf.gate_eligible and reproduced
            label = f"{RED}{BOLD}BLOCK{RESET}" if blocks else f"{YELLOW}WARN{RESET}"
            print(f"    {label}  {cf.gate_reason}")
            if blocks:
                gate_exit = 1
        else:
            print(f"    {GREEN}{BOLD}PASS{RESET}  no gate-eligible finding")

        step(9, "Spike assertions")
        if FIXED:
            check("FIXED MODE: no correlated finding survives", len(correlated) == 0,
                  "the black-box probe no longer observes a leak")
            check("FIXED MODE: gate exit is 0", gate_exit == 0, f"exit={gate_exit}")
            check(
                "FIXED MODE: stale static finding on unreachable code does not correlate",
                any(
                    loc.enclosing_symbol == "InvoiceService.find"
                    for f in whitebox
                    for loc in f.source_locations
                )
                and len(correlated) == 0,
                "InvoiceService.find is still flagged but is now dead code",
            )
        elif NO_COMMIT:
            check("UNVERIFIED MODE: correlation still produced", len(correlated) == 1,
                  "the finding is still reported — it is just not allowed to block")
            check("UNVERIFIED MODE: correlation marked unverified",
                  cf is not None and cf.correlation.verified is False,
                  f"verified={cf.correlation.verified if cf else 'n/a'}")
            check("UNVERIFIED MODE: does NOT block the build", gate_exit == 0,
                  "safety property: unverified provenance must never fail a build")
        else:
            check("exactly one correlated finding", len(correlated) == 1, f"got {len(correlated)}")
            check("points at InvoiceService.find, NOT the route handler",
                  cf is not None and cf.source_location.enclosing_symbol == "InvoiceService.find",
                  f"got {cf.source_location.enclosing_symbol if cf else 'none'}")
            check("correlation method is runtime_dump",
                  cf is not None and cf.correlation.method == "runtime_dump",
                  f"got {cf.correlation.method if cf else 'none'}")
            check("correlation verified against build provenance",
                  cf is not None and cf.correlation.verified is True,
                  f"verified={cf.correlation.verified if cf else 'n/a'}")
            check("both evidence artifacts preserved",
                  cf is not None and len(cf.evidence) == 2,
                  " + ".join(e.type for e in cf.evidence) if cf else "none")
            check("gate blocks the build", gate_exit == 1, f"exit={gate_exit}")

        failed = [c for c in checks if not c[1]]
        print(f"\n{BOLD}{'-' * 64}{RESET}")
        if not failed:
            print(f"{GREEN}{BOLD}SPIKE PASSED{RESET}  {len(checks)}/{len(checks)} checks")
        else:
            print(f"{RED}{BOLD}SPIKE FAILED{RESET}  {len(failed)}/{len(checks)} checks failed")
            for name, _, detail in failed:
                print(f"  {RED}x{RESET} {name} — {detail}")
        print(f"{DIM}gate exit code would be: {gate_exit}{RESET}")
        return 0 if not failed else 2

    finally:
        server.stop()
        restore(original)


if __name__ == "__main__":
    sys.exit(main())
