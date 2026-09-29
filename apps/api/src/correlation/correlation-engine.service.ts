import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeRoutePath, resolveRoutes } from './route-resolution';
import { symbolKey, type CorrelationInput, type CorrelationMatch, type CorrelationFinding, type ReachableSymbol } from './correlation.types';

const COMPATIBLE: Record<string, string[]> = {
  authz: ['authz_logic', 'static_security', 'authorization'],
  authorization: ['authorization', 'authz_logic', 'static_security'],
  authn: ['authz_logic', 'secrets'], security: ['static_security', 'input_validation', 'dependencies'],
  api_surface: ['input_validation', 'error_handling'], performance: ['code_quality'],
};

@Injectable()
export class CorrelationEngine {
  correlate(input: CorrelationInput): { correlated: CorrelationMatch[]; uncorrelatedIds: string[] } {
    if (!/^[a-f0-9]{40}$/iu.test(input.checkoutCommit)) throw new Error('A full checkout commit is required');
    if (input.routes.length > 5000 || input.blackbox.length > 5000 || input.whitebox.length > 5000 || input.evidence.length > 20000) throw new Error('Correlation input limit exceeded');
    const origin = new URL(input.targetOrigin).origin;
    const evidence = new Map(input.evidence.filter(item => item.auditId === input.auditId && !item.tombstonedAt && item.expiresAt > input.now).map(item => [item.id, item]));
    const consumed = new Set<string>();
    const merged = new Map<string, CorrelationMatch>();
    for (const blackbox of input.blackbox) {
      const observation = blackbox.observation;
      if (blackbox.auditId !== input.auditId || !observation || !blackbox.evidenceIds.includes(observation.evidenceId)) continue;
      const http = evidence.get(observation.evidenceId);
      if (!http || http.type !== 'http_exchange' || !http.replayable || http.truncated) continue;
      let url: URL;
      try { url = new URL(observation.url); } catch { continue; }
      if (url.origin !== origin || url.username || url.password) continue;
      const routes = resolveRoutes(observation.method, url.pathname, input.routes);
      const bindings = new Map(routes.map(route => [symbolKey(route.handler), route]));
      if (bindings.size !== 1) continue;
      const route = [...bindings.values()][0];
      const graph = input.graphs.get(symbolKey(route.handler));
      if (!graph || graph.truncated || symbolKey(graph.handler) !== symbolKey(route.handler)) continue;
      const reachable = new Map(graph.reachable.map(location => [symbolKey(location), location]));
      const candidates: Array<{ finding: CorrelationFinding; source: ReachableSymbol }> = [];
      for (const whitebox of input.whitebox) {
        if (whitebox.auditId !== input.auditId || !COMPATIBLE[blackbox.category]?.includes(whitebox.category)) continue;
        if (blackbox.cwe && whitebox.cwe && blackbox.cwe !== whitebox.cwe) continue;
        if (!whitebox.evidenceIds.some(id => ['sast_json', 'source_excerpt'].includes(evidence.get(id)?.type ?? ''))) continue;
        for (const location of whitebox.sourceLocations) {
          if (!location.verified || location.commitSha.toLowerCase() !== input.checkoutCommit.toLowerCase()) continue;
          const source = reachable.get(symbolKey(location));
          if (source) candidates.push({ finding: whitebox, source });
        }
      }
      if (!candidates.length) continue;
      const depth = Math.max(...candidates.map(candidate => candidate.source.depth));
      const deepest = candidates.filter(candidate => candidate.source.depth === depth);
      const roots = new Map(deepest.map(candidate => [JSON.stringify([symbolKey(candidate.source), candidate.finding.ruleId, candidate.finding.cwe]), candidate]));
      if (roots.size !== 1) continue;
      const { finding: whitebox, source } = [...roots.values()][0];
      const verified = Boolean(input.provenance?.verified && input.provenance.commitSha?.toLowerCase() === input.checkoutCommit.toLowerCase());
      const pathTemplate = normalizeRoutePath(route.pathTemplate);
      const fingerprint = createHash('sha256').update(JSON.stringify([
        input.projectId, whitebox.category, whitebox.ruleId ?? `agent.${whitebox.category}.${whitebox.cwe ?? 'nocwe'}`,
        origin, observation.method.toUpperCase(), pathTemplate, source.file, source.enclosingSymbol, whitebox.cwe,
      ])).digest('hex');
      const evidenceIds = [...new Set([observation.evidenceId, ...blackbox.evidenceIds, ...deepest.flatMap(candidate => candidate.finding.evidenceIds)])].filter(id => evidence.has(id)).sort();
      const prior = merged.get(fingerprint);
      const current: CorrelationMatch = {
        fingerprint, blackboxFindingIds: [blackbox.id], whiteboxFindingIds: [...new Set(deepest.map(candidate => candidate.finding.id))].sort(), evidenceIds,
        routeId: route.id, method: route.source, confidenceBand: route.source === 'static_parse' ? 'medium' : 'high',
        sourceLocation: { file: source.file, enclosingSymbol: source.enclosingSymbol, line: source.line, commitSha: input.checkoutCommit, verified },
        verified, gateEligible: false,
        rationale: `${observation.method.toUpperCase()} ${pathTemplate} reaches ${source.enclosingSymbol} through ${source.path.join(' -> ')}. ` +
          (verified ? 'Deployment and checkout commit match; release blocking still requires independent replay.' : 'Deployment/source binding is unverified; source attribution is advisory.'),
      };
      if (prior) {
        prior.blackboxFindingIds = [...new Set([...prior.blackboxFindingIds, ...current.blackboxFindingIds])].sort();
        prior.whiteboxFindingIds = [...new Set([...prior.whiteboxFindingIds, ...current.whiteboxFindingIds])].sort();
        prior.evidenceIds = [...new Set([...prior.evidenceIds, ...evidenceIds])].sort();
      } else merged.set(fingerprint, current);
      consumed.add(blackbox.id);
      deepest.forEach(candidate => consumed.add(candidate.finding.id));
    }
    return { correlated: [...merged.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
      uncorrelatedIds: [...new Set([...input.blackbox, ...input.whitebox].filter(finding => !consumed.has(finding.id)).map(finding => finding.id))].sort() };
  }
}
