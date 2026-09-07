export interface ReconCandidate {
  url: string;
  method: string;
  source: string;
}

export interface VerifiedEndpointCandidate extends ReconCandidate {
  status?: number;
  contentType?: string;
  technologies: string[];
  title?: string;
  server?: string;
  redirectLocation?: string;
}

export interface CanonicalEndpoint {
  method: string;
  pathTemplate: string;
  parameters: Array<{ name: string; in: 'query'; type: 'string' }>;
  rawExample: string;
}
