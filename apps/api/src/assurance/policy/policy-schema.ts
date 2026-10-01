/**
 * M6 — Gate policy DSL (Workstream A).
 *
 * The policy is the only thing the gate engine reads besides findings and
 * evidence. It is versioned, project-scoped, and stored as JSON on
 * `GatePolicy.rules`. Parsing is fail-closed: unknown keys are rejected
 * (`.strict()`), and a policy that does not parse must never evaluate — the
 * caller treats a parse failure as a FAIL (see 12-policy-gate §7).
 *
 * This module has no Nest, Prisma, or network dependency. The engine and the
 * (future) GatePolicyService both validate against the schema defined here.
 */
import { z } from 'zod';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const FINDING_STATUSES = [
  'new', 'open', 'fixed', 'verified', 'regressed', 'not_reproduced', 'false_positive', 'accepted_risk',
] as const;
export const AUDIT_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export const FINDING_ORIGINS = ['blackbox', 'whitebox', 'tool', 'correlated'] as const;
export const CORRELATION_METHODS = ['runtime_dump', 'openapi', 'static_parse', 'request_id', 'ai_inference'] as const;
/** Policy-level provenance of a finding, distinct from its storage `origin`. */
export const POLICY_SOURCES = ['deterministic', 'agent'] as const;
/** Rollout phases (12-policy-gate §10). Default `observe` so a newly onboarded
 *  project cannot produce a surprise red build before its FP profile is known. */
export const GATE_MODES = ['observe', 'block_critical', 'full'] as const;

export type Severity = (typeof SEVERITIES)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type FindingOrigin = (typeof FINDING_ORIGINS)[number];
export type CorrelationMethod = (typeof CORRELATION_METHODS)[number];
export type PolicySource = (typeof POLICY_SOURCES)[number];
export type GateMode = (typeof GATE_MODES)[number];

const nonEmpty = <T extends z.ZodTypeAny>(inner: T) => z.array(inner).nonempty();

/** A single `block_on` clause. Every field is a narrowing condition; a clause
 *  with no condition is meaningless and rejected by the refinement below. */
const blockRule = z
  .object({
    source: z.enum(POLICY_SOURCES).optional(),
    category: nonEmpty(z.string().min(1)).optional(),
    severity: nonEmpty(z.enum(SEVERITIES)).optional(),
    finding_status: nonEmpty(z.enum(FINDING_STATUSES)).optional(),
    requires_replayable_evidence: z.boolean().optional(),
    regression: z.literal('critical_test_failed').optional(),
    required_categories_not_executed: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (r) => Object.keys(r).some((k) => k !== 'requires_replayable_evidence'),
    { message: 'a block_on clause needs at least one matching condition' },
  );

const warnRule = z
  .object({
    source: z.enum(POLICY_SOURCES).optional(),
    category: nonEmpty(z.string().min(1)).optional(),
    severity: nonEmpty(z.enum(SEVERITIES)).optional(),
    requires_replayable_evidence: z.boolean().optional(),
    correlation_method: nonEmpty(z.enum(CORRELATION_METHODS)).optional(),
    provenance_unverified: z.literal(true).optional(),
  })
  .strict()
  .refine((r) => Object.keys(r).length > 0, { message: 'a warn_on clause needs at least one condition' });

export const gatePolicySchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().min(1),
    mode: z.enum(GATE_MODES).default('observe'),
    block_on: z.array(blockRule).default([]),
    warn_on: z.array(warnRule).default([]),
    required_categories: z.array(z.string().min(1)).default([]),
    fail_closed: z
      .object({
        audit_status: nonEmpty(z.enum(AUDIT_STATUSES)).default(['failed', 'partial']),
        // When set to this value, an unverified build provenance downgrades
        // only *correlated* findings to advisory, instead of failing the audit.
        provenance_verified: z.literal('false_blocks_correlated_findings_only').optional(),
        replay_error: z.literal('block').optional(),
      })
      .strict()
      .default({}),
    waivers: z
      .object({
        max_duration_days: z.number().int().positive(),
        require_separate_approver: z.boolean(),
        warn_before_expiry_days: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type BlockRule = z.infer<typeof blockRule>;
export type WarnRule = z.infer<typeof warnRule>;
export type ParsedPolicy = z.infer<typeof gatePolicySchema>;

/** Parse-or-throw. The caller turns a thrown `ZodError` into a fail-closed
 *  gate outcome (12-policy-gate §7: "Gate policy fails to load → FAIL"). */
export function parsePolicy(input: unknown): ParsedPolicy {
  return gatePolicySchema.parse(input);
}

/** Non-throwing variant for callers that want to branch on validity. */
export function safeParsePolicy(input: unknown): z.SafeParseReturnType<unknown, ParsedPolicy> {
  return gatePolicySchema.safeParse(input);
}

/**
 * The seeded project default (12-policy-gate §4). Ships in `observe` mode: it
 * evaluates and reports but does not block until a human promotes the project.
 */
export const DEFAULT_GATE_POLICY: ParsedPolicy = parsePolicy({
  version: 1,
  name: 'default',
  mode: 'observe',
  block_on: [
    { source: 'deterministic', severity: ['critical'] },
    { source: 'deterministic', category: ['static_security', 'secrets', 'dependencies'], severity: ['critical', 'high'] },
    { source: 'agent', severity: ['critical'], requires_replayable_evidence: true },
    { source: 'agent', category: ['authz', 'authn'], severity: ['critical', 'high'], requires_replayable_evidence: true },
    { regression: 'critical_test_failed' },
    { finding_status: ['regressed'], severity: ['critical', 'high'] },
    { required_categories_not_executed: true },
  ],
  warn_on: [
    { source: 'agent', severity: ['high'], requires_replayable_evidence: false },
    { correlation_method: ['ai_inference'] },
    { provenance_unverified: true },
  ],
  required_categories: ['security', 'authz', 'static_security', 'dependencies'],
  fail_closed: {
    audit_status: ['failed', 'partial'],
    provenance_verified: 'false_blocks_correlated_findings_only',
    replay_error: 'block',
  },
  waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 },
});
