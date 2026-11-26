import { z } from 'zod';

/**
 * Strict zod mirror of cloudflare/security-audit-skill `report-schema.json`
 * (MIT). Every variant is `additionalProperties: false`, hence `.strict()`.
 * The upstream Node validators are not used at runtime.
 */
const Level = z.enum(['informational', 'low', 'medium', 'high', 'critical']);
const nonEmpty = z.string().min(1);
const line = z.number().int().min(1);

const TraceItem = z.object({
  kind: z.enum(['entrypoint', 'propagation', 'sink']),
  file: z.string(), line, scope: z.string(), description: z.string(),
}).strict();

const EvidenceItem = z.object({ file: z.string(), line, description: z.string() }).strict();

const Common = {
  fingerprint: nonEmpty.regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u),
  title: nonEmpty,
  description: nonEmpty,
  trace: z.array(TraceItem).min(1),
  evidence: z.array(EvidenceItem).min(1),
};

const Confirmed = z.object({
  verdict: z.literal('confirmed'), ...Common,
  root_cause: z.string(), intended_behavior: z.string(),
  conditions: z.array(z.object({
    kind: z.enum(['authentication_level', 'authorization_role', 'user_interaction', 'system_configuration',
      'network_routing', 'environmental_dependency', 'data_state', 'timing_dependency', 'third_party_dependency']),
    description: z.string(),
  }).strict()),
  execution: z.object({
    attacker_perspective: z.string(), payloads: z.array(z.string()).min(1),
    instructions: z.array(z.string()).min(1), observed_result: z.string(),
  }).strict(),
  remediation: z.object({
    strategy: z.string(),
    code_changes: z.array(z.object({ file_name: z.string(), fixed_code: z.string() }).strict()).optional(),
  }).strict(),
  severity: z.object({
    likelihood: z.object({ score: Level, reason: z.string() }).strict(),
    impact: z.object({ score: Level, reason: z.string() }).strict(),
    overall_severity: Level,
  }).strict(),
  confidence: z.object({ score: z.enum(['low', 'medium', 'high']), reason: z.string() }).strict(),
}).strict();

const NeedsValidation = z.object({
  verdict: z.literal('needs_validation'), ...Common,
  claimed_root_cause: z.string(),
  blockers: z.array(z.string()).min(1),
  validation_plan: z.object({ local: z.string().optional(), deployment: z.string().optional() }).strict(),
}).strict();

const Rejected = z.object({
  verdict: z.literal('rejected'), ...Common,
  claimed_root_cause: z.string(), reason: z.string(),
}).strict();

export const SecurityAuditFindingSchema = z.discriminatedUnion('verdict', [Confirmed, NeedsValidation, Rejected]);
export const SecurityAuditReportSchema = z.array(SecurityAuditFindingSchema);

export type SecurityAuditFinding = z.infer<typeof SecurityAuditFindingSchema>;
export type ConfirmedFinding = z.infer<typeof Confirmed>;
