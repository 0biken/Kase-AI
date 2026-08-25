"""
THE JOIN — identical logic to the NestJS spike, different framework beneath.

    black-box finding
      -> observed path        /api/invoices/inv_1001
      -> normalized template  /api/invoices/{invoice_id}
      -> route mapping        fixture.app.find_one          [runtime_dump]
      -> code map walk        InvoiceService.find           [Depends chain]
      -> white-box finding at that symbol
      => ONE correlated finding

The match key is the ENCLOSING SYMBOL, never the line number (ADR-004).
"""

from dataclasses import dataclass, field
from typing import Any, Optional

from .codemap import CodeMapEntry, SourceLocation
from .routemap import RouteMapping, templatize
from .sast import Evidence, Finding, sha256, short_hash


@dataclass
class Correlation:
    blackbox_finding_id: str
    whitebox_finding_id: str
    route: RouteMapping
    source_location: SourceLocation
    method: str
    verified: bool
    chain_description: str


@dataclass
class CorrelatedFinding:
    id: str
    fingerprint: str
    title: str
    severity: str
    affected_target: str
    source_location: SourceLocation
    correlation: Correlation
    evidence: list[Evidence] = field(default_factory=list)
    gate_eligible: bool = False
    gate_reason: str = ""


def compute_fingerprint(
    category: str,
    rule_id: Optional[str],
    target: str,
    file: str,
    symbol: str,
    cwe: Optional[str],
) -> str:
    """
    Deterministic inputs only.

    Excluded on purpose: AI-authored root cause (unstable across runs) and
    line numbers (shift on any edit above). See ADR-004.
    """
    canonical = "|".join([category, rule_id or "-", target, file, symbol, cwe or "-"])
    return sha256(canonical)[:16]


def correlate(
    blackbox: list[Finding],
    whitebox: list[Finding],
    routes: list[RouteMapping],
    code_map: dict[str, CodeMapEntry],
    provenance: dict[str, Any],
) -> tuple[list[CorrelatedFinding], list[Finding]]:
    correlated: list[CorrelatedFinding] = []
    consumed: set[str] = set()
    uncorrelated: list[Finding] = []

    for bb in blackbox:
        if not bb.affected_target:
            uncorrelated.append(bb)
            continue

        template = templatize(bb.affected_target, routes)
        if not template:
            uncorrelated.append(bb)
            continue

        route = next((r for r in routes if r.path_template == template), None)
        if route is None:
            uncorrelated.append(bb)
            continue

        entry = code_map.get(route.handler_symbol)
        if entry is None:
            uncorrelated.append(bb)
            continue

        reachable = set(entry.reachable_symbols)
        match = next(
            (
                wb
                for wb in whitebox
                if any(loc.enclosing_symbol in reachable for loc in wb.source_locations)
            ),
            None,
        )
        if match is None:
            uncorrelated.append(bb)
            continue

        source_location = next(
            loc for loc in match.source_locations if loc.enclosing_symbol in reachable
        )

        correlation = Correlation(
            blackbox_finding_id=bb.id,
            whitebox_finding_id=match.id,
            route=route,
            source_location=source_location,
            method=route.source,
            # Only trustworthy if the running target was built from the
            # source we just read (ADR-003).
            verified=bool(provenance.get("verified")),
            chain_description=_describe_chain(route, entry, source_location),
        )

        consumed.add(match.id)

        fingerprint = compute_fingerprint(
            category=match.category,
            rule_id=match.rule_id,
            target=template,
            file=source_location.file,
            symbol=source_location.enclosing_symbol,
            cwe=match.cwe,
        )

        evidence = [*bb.evidence, *match.evidence]
        has_replayable = any(e.evidence_class == "replayable" for e in evidence)
        verified = bool(provenance.get("verified"))

        correlated.append(
            CorrelatedFinding(
                id=f"CF-{short_hash(fingerprint)}",
                fingerprint=fingerprint,
                title=match.title,
                severity="critical",
                affected_target=template,
                source_location=source_location,
                correlation=correlation,
                evidence=evidence,
                gate_eligible=has_replayable and verified,
                gate_reason=_gate_reason(has_replayable, verified),
            )
        )

    leftover = [wb for wb in whitebox if wb.id not in consumed]
    return correlated, [*uncorrelated, *leftover]


def _gate_reason(has_replayable: bool, verified: bool) -> str:
    if not verified:
        return (
            "NOT gate-eligible: build provenance unverified — the running target "
            "cannot be shown to match the audited source, so the source location "
            "may be wrong. Reported as advisory."
        )
    if not has_replayable:
        return "NOT gate-eligible: no replayable evidence artifact."
    return "Gate-eligible: replayable evidence present and provenance verified."


def _describe_chain(
    route: RouteMapping, entry: CodeMapEntry, target: SourceLocation
) -> str:
    hops = [f"{route.method} {route.path_template}", route.handler_symbol]
    for edge in entry.chain:
        hops.append(edge.to_symbol)
        if edge.to_symbol == target.enclosing_symbol:
            break
    return "  ->  ".join(hops)
