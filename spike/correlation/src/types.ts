/**
 * Shapes mirrored from docs/03-data-model. Trimmed to what the correlation
 * path needs — the spike proves the join, not the persistence layer.
 */

export interface BuildProvenance {
  commitSha: string | null;
  source: 'ci_supplied' | 'build_info_endpoint' | 'response_header' | 'assumed';
  verified: boolean;
}

export interface RouteMapping {
  method: string;
  pathTemplate: string;          // '/api/invoices/{id}' — normalized
  framework: 'nestjs';
  handlerSymbol: string;         // 'InvoiceController.findOne'
  controllerClass: string;
  handlerMethod: string;
  source: 'runtime_dump' | 'openapi' | 'static_parse';
}

export interface SourceLocation {
  file: string;
  enclosingSymbol: string;       // 'InvoiceService.find' — the stable key
  line: number;
}

/** One hop in the controller -> service call chain. */
export interface CallEdge {
  fromSymbol: string;
  toSymbol: string;
  via: string;                   // the injected property, e.g. 'invoiceService'
  location: SourceLocation;
}

export interface CodeMapEntry {
  handlerSymbol: string;
  handlerLocation: SourceLocation;
  chain: CallEdge[];
  /** Every symbol reachable from the handler, handler included. */
  reachableSymbols: string[];
}

export interface HttpExchange {
  request: { method: string; url: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: string };
  replayHash: string;
}

export type EvidenceClass = 'replayable' | 'observational';

export interface Evidence {
  id: string;
  tool: string;
  type: 'http_exchange' | 'sast_json' | 'source_excerpt';
  evidenceClass: EvidenceClass;
  sha256: string;
  payload: unknown;
}

export interface Finding {
  id: string;
  origin: 'blackbox' | 'whitebox' | 'correlated';
  tool: string;
  ruleId: string | null;
  category: string;
  cwe: string | null;
  title: string;
  severityProposed: 'critical' | 'high' | 'medium' | 'low' | 'info';
  affectedTarget: string | null;   // normalized path template
  sourceLocations: SourceLocation[];
  evidence: Evidence[];
  description: string;
}

export interface Correlation {
  blackboxFindingId: string;
  whiteboxFindingId: string;
  route: RouteMapping;
  sourceLocation: SourceLocation;
  method: 'runtime_dump' | 'openapi' | 'static_parse' | 'ai_inference';
  verified: boolean;               // false when provenance is unverified
  chainDescription: string;
}

export interface CorrelatedFinding {
  id: string;
  fingerprint: string;
  title: string;
  severity: string;
  affectedTarget: string;
  sourceLocation: SourceLocation;
  correlation: Correlation;
  evidence: Evidence[];
  gateEligible: boolean;
  gateReason: string;
}
