import {
  Finding, RouteMapping, CodeMapEntry, Correlation, CorrelatedFinding,
  BuildProvenance, SourceLocation,
} from './types';
import { templatize } from './routemap';
import { sha256, shortHash } from './sast';

/**
 * THE JOIN.
 *
 *   black-box finding
 *     -> observed path            /api/invoices/inv_1001
 *     -> normalized template      /api/invoices/{id}
 *     -> route mapping            InvoiceController.findOne     [runtime_dump]
 *     -> code map walk            InvoiceService.find           [call chain]
 *     -> white-box finding at that symbol
 *     => ONE correlated finding
 *
 * The match key is the ENCLOSING SYMBOL, never the line number. Lines shift
 * on any edit above them; symbols do not (ADR-004).
 */
export function correlate(
  blackboxFindings: Finding[],
  whiteboxFindings: Finding[],
  routes: RouteMapping[],
  codeMap: Map<string, CodeMapEntry>,
  provenance: BuildProvenance,
): { correlated: CorrelatedFinding[]; uncorrelated: Finding[] } {
  const correlated: CorrelatedFinding[] = [];
  const consumedWhitebox = new Set<string>();
  const uncorrelated: Finding[] = [];

  for (const bb of blackboxFindings) {
    if (!bb.affectedTarget) { uncorrelated.push(bb); continue; }

    const template = templatize(bb.affectedTarget, routes);
    if (!template) { uncorrelated.push(bb); continue; }

    const route = routes.find((r) => r.pathTemplate === template);
    if (!route) { uncorrelated.push(bb); continue; }

    const entry = codeMap.get(route.handlerSymbol);
    if (!entry) { uncorrelated.push(bb); continue; }

    // A white-box finding correlates if it sits on any symbol reachable
    // from this route's handler.
    const reachable = new Set(entry.reachableSymbols);
    const match = whiteboxFindings.find((wb) =>
      wb.sourceLocations.some((loc) => reachable.has(loc.enclosingSymbol)),
    );

    if (!match) { uncorrelated.push(bb); continue; }

    const sourceLocation = match.sourceLocations.find((loc) =>
      reachable.has(loc.enclosingSymbol),
    ) as SourceLocation;

    const correlation: Correlation = {
      blackboxFindingId: bb.id,
      whiteboxFindingId: match.id,
      route,
      sourceLocation,
      method: route.source,
      // Correlation is only trustworthy if the running target was built
      // from the source we just read (ADR-003).
      verified: provenance.verified,
      chainDescription: describeChain(route, entry, sourceLocation),
    };

    consumedWhitebox.add(match.id);

    const fingerprint = computeFingerprint({
      category: match.category,
      ruleId: match.ruleId,
      target: template,
      file: sourceLocation.file,
      symbol: sourceLocation.enclosingSymbol,
      cwe: match.cwe,
    });

    const evidence = [...bb.evidence, ...match.evidence];
    const hasReplayable = evidence.some((e) => e.evidenceClass === 'replayable');

    correlated.push({
      id: `CF-${shortHash(fingerprint)}`,
      fingerprint,
      title: match.title,
      severity: 'critical',
      affectedTarget: template,
      sourceLocation,
      correlation,
      evidence,
      // Two independent conditions, both required (ADR-002 + ADR-003).
      gateEligible: hasReplayable && provenance.verified,
      gateReason: gateReason(hasReplayable, provenance.verified),
    });
  }

  const leftoverWhitebox = whiteboxFindings.filter((wb) => !consumedWhitebox.has(wb.id));
  return { correlated, uncorrelated: [...uncorrelated, ...leftoverWhitebox] };
}

function gateReason(hasReplayable: boolean, verified: boolean): string {
  if (!verified) {
    return 'NOT gate-eligible: build provenance unverified — the running target ' +
           'cannot be shown to match the audited source, so the source location ' +
           'may be wrong. Reported as advisory.';
  }
  if (!hasReplayable) {
    return 'NOT gate-eligible: no replayable evidence artifact.';
  }
  return 'Gate-eligible: replayable evidence present and provenance verified.';
}

function describeChain(
  route: RouteMapping,
  entry: CodeMapEntry,
  target: SourceLocation,
): string {
  const hops = [`${route.method} ${route.pathTemplate}`, route.handlerSymbol];
  for (const edge of entry.chain) {
    hops.push(edge.toSymbol);
    if (edge.toSymbol === target.enclosingSymbol) break;
  }
  return hops.join('  ->  ');
}

/**
 * Deterministic inputs only.
 *
 * Excluded on purpose: AI-authored root cause (unstable across runs) and
 * line numbers (shift on any edit above). See ADR-004.
 */
export function computeFingerprint(parts: {
  category: string;
  ruleId: string | null;
  target: string;
  file: string;
  symbol: string;
  cwe: string | null;
}): string {
  const canonical = [
    parts.category,
    parts.ruleId ?? '-',
    parts.target,
    parts.file,
    parts.symbol,
    parts.cwe ?? '-',
  ].join('|');
  return sha256(canonical).slice(0, 16);
}
