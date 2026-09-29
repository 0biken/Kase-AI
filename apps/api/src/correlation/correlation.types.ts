export type MappingMethod = 'runtime_dump' | 'openapi' | 'static_parse';
export interface SymbolLocation { file: string; enclosingSymbol: string; line: number }
export interface ResolvedRoute {
  id: string; method: string; pathTemplate: string; handler: SymbolLocation; source: MappingMethod;
}
export interface ReachableSymbol extends SymbolLocation { depth: number; path: string[] }
export interface SymbolGraph { handler: SymbolLocation; reachable: ReachableSymbol[]; truncated: boolean }
export interface CorrelationEvidence {
  id: string; auditId: string; type: string; replayable: boolean; truncated: boolean;
  expiresAt: Date; tombstonedAt: Date | null;
}
export interface CorrelationFinding {
  id: string; auditId: string; category: string; ruleId: string | null; cwe: string | null;
  sourceLocations: Array<SymbolLocation & { commitSha: string; verified: boolean }>;
  evidenceIds: string[];
  /** Derived from captured HTTP evidence, never inferred from model prose. */
  observation?: { method: string; url: string; evidenceId: string };
}
export interface CorrelationInput {
  auditId: string; projectId: string; targetOrigin: string; checkoutCommit: string;
  provenance: { commitSha: string | null; verified: boolean } | null;
  routes: ResolvedRoute[]; graphs: Map<string, SymbolGraph>;
  blackbox: CorrelationFinding[]; whitebox: CorrelationFinding[];
  evidence: CorrelationEvidence[]; now: Date;
}
export interface CorrelationMatch {
  fingerprint: string; blackboxFindingIds: string[]; whiteboxFindingIds: string[]; evidenceIds: string[];
  routeId: string; method: MappingMethod; confidenceBand: 'high' | 'medium';
  sourceLocation: SymbolLocation & { commitSha: string; verified: boolean };
  verified: boolean;
  /** M6 independently replays evidence before enabling release blocking. */
  gateEligible: false;
  rationale: string;
}
export function symbolKey(location: Pick<SymbolLocation, 'file' | 'enclosingSymbol'>): string {
  return JSON.stringify([location.file.replace(/\\/gu, '/').replace(/^\.\//u, ''), location.enclosingSymbol]);
}
