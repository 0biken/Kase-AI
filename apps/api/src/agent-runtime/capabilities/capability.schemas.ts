/**
 * Typed capability schemas for agent tool calls (ADR-008).
 *
 * Every capability is individually typed and validated. No generic
 * run_tool({cmd}) or command-shaped arguments. The agent worker has
 * no target egress; only Tool Runner workers execute after scope validation.
 *
 * Validation errors are returned to the model as structured, actionable
 * feedback for at most MAX_VALIDATION_CORRECTIONS correction turns.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common refinements
// ---------------------------------------------------------------------------

/** Rejects strings that look like shell commands or path traversals. */
const safeString = z.string().min(1).max(4096)
  .refine((s) => !/[;|`$(){}]/.test(s), 'Command-shaped characters are not allowed')
  .refine((s) => !s.includes('..'), 'Path traversal sequences are not allowed');

/** Valid HTTP methods for probing. */
const httpMethod = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** URL that must be http or https, no credentials, no fragments. */
const httpUrl = z.string().url().refine((u) => {
  try {
    const parsed = new URL(u);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password && !parsed.hash;
  } catch { return false; }
}, 'URL must be http/https without embedded credentials');

/** Header value that must not contain raw secrets or known credential patterns. */
const safeHeaderValue = z.string().max(8192)
  .refine((v) => !/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/.test(v), 'Raw bearer tokens are not allowed in headers; use testIdentityId')
  .refine((v) => !/Basic\s+[A-Za-z0-9+/=]{10,}/.test(v), 'Raw basic auth is not allowed in headers; use testIdentityId');

// ---------------------------------------------------------------------------
// Read-only capabilities
// ---------------------------------------------------------------------------

export const GetEndpointInventorySchema = z.object({
  capability: z.literal('get_endpoint_inventory'),
});

export const GetRouteMapSchema = z.object({
  capability: z.literal('get_route_map'),
});

export const GetSourceSchema = z.object({
  capability: z.literal('get_source'),
  file: safeString.refine(
    (f) => !f.startsWith('/') && !f.startsWith('\\') && !f.includes('..'),
    'File must be a relative path within the repository checkout',
  ),
  symbol: safeString.optional(),
  /** Maximum lines to return, centred on the symbol. Default 400. */
  maxLines: z.number().int().min(1).max(400).default(400),
});

export const SearchSourceSchema = z.object({
  capability: z.literal('search_source'),
  query: safeString,
  kind: z.enum(['grep', 'symbol']),
  maxResults: z.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Execution capabilities
// ---------------------------------------------------------------------------

export const RunHttpProbeSchema = z.object({
  capability: z.literal('run_http_probe'),
  /** References a TestIdentity row by ID. The recon worker decrypts and injects. */
  testIdentityId: z.string().min(1),
  url: httpUrl.refine(
    (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('169.254'),
    'Link-local and localhost URLs are not allowed'
  ),
  method: httpMethod,
  headers: z.record(safeHeaderValue.refine(v => !/[\r\n]/.test(v), 'Header line breaks forbidden')).refine(h => Object.keys(h).every(k => /^[A-Za-z0-9-]+$/.test(k) && !/^(authorization|proxy-authorization|cookie|host|connection|transfer-encoding|content-length)$/i.test(k)), 'Reserved headers must be server supplied').optional(),
  body: z.string().max(65536).optional(),
  followRedirects: z.boolean().default(false),
});

export const RunSastSchema = z.object({
  capability: z.literal('run_sast'),
  /** Server-approved pack reference. No filesystem path or URL accepted. */
  packReference: z.string().min(1).max(256).refine(
    (p) => !p.includes('/') && !p.includes('\\') && !p.includes('..') && !p.startsWith('http'),
    'Pack reference must be a server-approved identifier, not a path or URL',
  ),
  /** May reuse existing evidence if a prior SAST run already produced it. */
  reuseExistingEvidence: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Persistence capabilities
// ---------------------------------------------------------------------------

export const AttachEvidenceSchema = z.object({
  capability: z.literal('attach_evidence'),
  evidenceId: z.string().min(1),
  description: safeString.optional(),
});

export const CreateFindingSchema = z.object({
  capability: z.literal('create_finding'),
  category: z.string().min(1).max(100),
  /** Advisory only — severity engine recomputes. */
  severityProposed: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
  title: safeString,
  cwe: z.string().regex(/^CWE-\d+$/).optional(),
  reproduction: z.object({
    kind: z.enum(['http_replay', 'code_location', 'scanner_hit']),
    evidenceId: z.string().min(1),
  }),
  impact: safeString,
  remediation: safeString,
  remediationPatch: z.string().max(65536).optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  sourceLocations: z.array(z.object({
    file: safeString,
    enclosingSymbol: safeString,
  })).max(10).optional(),
});

export const RecordPassingCheckSchema = z.object({
  capability: z.literal('record_passing_check'),
  category: z.string().min(1).max(100),
  checkId: z.string().min(1).max(256),
  target: z.string().optional(),
  evidenceIds: z.array(z.string().min(1)).max(20).optional(),
});

export const ReportBlockedSchema = z.object({
  capability: z.literal('report_blocked'),
  category: z.string().min(1).max(100),
  reason: z.enum([
    'tool_unavailable',
    'target_unreachable',
    'auth_failed',
    'out_of_scope',
    'budget_exhausted',
    'destructive_not_authorized',
  ]),
  details: safeString.optional(),
});

export const RequestScopeChangeSchema = z.object({
  capability: z.literal('request_scope_change'),
  host: z.string().min(1).max(256),
  reason: safeString,
});

export const FinishAuditSchema = z.object({
  capability: z.literal('finish_audit'),
  summary: safeString,
});

// ---------------------------------------------------------------------------
// Discriminated union of all capabilities
// ---------------------------------------------------------------------------

export const CapabilitySchema = z.discriminatedUnion('capability', [
  GetEndpointInventorySchema,
  GetRouteMapSchema,
  GetSourceSchema,
  SearchSourceSchema,
  RunHttpProbeSchema,
  RunSastSchema,
  AttachEvidenceSchema,
  CreateFindingSchema,
  RecordPassingCheckSchema,
  ReportBlockedSchema,
  RequestScopeChangeSchema,
  FinishAuditSchema,
]);

export type CapabilityArgs = z.infer<typeof CapabilitySchema>;
export type CapabilityName = CapabilityArgs['capability'];

// ---------------------------------------------------------------------------
// Tool descriptions for the model
// ---------------------------------------------------------------------------

export const CAPABILITY_TOOL_DESCRIPTIONS: Record<CapabilityName, string> = {
  get_endpoint_inventory: 'Read the canonical endpoint inventory discovered during reconnaissance. Returns method, path template, status codes, and technologies for each endpoint.',
  get_route_map: 'Read the code map route mappings that link HTTP endpoints to their handler symbols, files, and downstream service dependencies.',
  get_source: 'Retrieve a source code excerpt from the repository at the audit commit. Specify a file and optionally a symbol to centre the excerpt on.',
  search_source: 'Search the repository source code by grep pattern or symbol name. Returns matching file locations and line excerpts.',
  run_http_probe: 'Send an HTTP request to the target using a specific test identity. The server injects credentials securely — never include raw tokens. Returns the full HTTP exchange as evidence.',
  run_sast: 'Run a static analysis scan with a server-approved rule pack. May reuse existing evidence from a prior scan in this audit.',
  attach_evidence: 'Register an existing evidence artifact as relevant to the current analysis. The evidence must belong to this audit and be live (not tombstoned).',
  create_finding: 'Propose a security finding. Requires at least one same-audit evidence artifact. Black-box security findings require replayable HTTP evidence. Severity is recomputed centrally — your proposal is advisory.',
  record_passing_check: 'Record that a specific check passed cleanly. This distinguishes "tested and clean" from "never tested" for gate coverage.',
  report_blocked: 'Report that a test category could not be executed. This is the signal that lets the gate enforce "required category failed to execute."',
  request_scope_change: 'Request permission to test a host outside the current scope allowlist. This request is always denied and always logged — it exists so scope gaps are visible rather than silently skipped.',
  finish_audit: 'Terminate the agent loop with a summary. Call this when all planned testing is complete or when instructed to wind down.',
};

import { zodToJsonSchema } from 'zod-to-json-schema';

// ---------------------------------------------------------------------------
// Convert to Tool Schemas
// ---------------------------------------------------------------------------

/**
 * Convert Kase capability schemas to provider tool schemas.
 * Each capability becomes one tool with its Zod schema converted to JSON Schema.
 */
export function capabilityToolSchemas() {
  const schemas = [
    GetEndpointInventorySchema,
    GetRouteMapSchema,
    GetSourceSchema,
    SearchSourceSchema,
    RunHttpProbeSchema,
    RunSastSchema,
    AttachEvidenceSchema,
    CreateFindingSchema,
    RecordPassingCheckSchema,
    ReportBlockedSchema,
    RequestScopeChangeSchema,
    FinishAuditSchema,
  ];

  return schemas.map((schema) => {
    // Extract the capability name from the literal
    const shape = (schema as any).shape ?? (schema as any)._def?.schema?.shape;
    const capName = shape?.capability?._def?.value as string;
    
    // Create a schema that omits the 'capability' literal since it's implied by the tool name
    const toolArgsSchema = schema instanceof z.ZodEffects 
      ? (schema as any).innerType().omit({ capability: true })
      : (schema as any).omit({ capability: true });

    return {
      name: capName,
      description: CAPABILITY_TOOL_DESCRIPTIONS[capName as CapabilityName],
      inputSchema: zodToJsonSchema(toolArgsSchema, { $refStrategy: 'none' }) as Record<string, unknown>,
    };
  });
}
