/**
 * Budget defaults from docs/11-ai-layer §5.
 *
 * Stated once rather than scattered across services. A deployment
 * may override via ProjectAiConfiguration; these are the documented
 * contract values.
 */

// ---------------------------------------------------------------------------
// Per-audit totals
// ---------------------------------------------------------------------------

export const BUDGET_TOTAL_TOKENS = 2_000_000;
export const BUDGET_MAX_CALLS = 120;
export const BUDGET_MAX_CONTEXT_BYTES = 400_000;
export const BUDGET_MAX_CONCURRENT_AGENTS = 2;
export const BUDGET_MAX_OUTPUT_TOKENS = 16_000;

// ---------------------------------------------------------------------------
// Stage allocations — docs/11 §5
//
//   Black Box agent   45% of token budget
//   White Box agent   35%
//   Correlation        5%
//   Finding review    10%
//   Report             5%
//
// M4 consumes only the agent stages. The remaining 20% is reserved for
// correlation/review/report stages added in M5/M6.
// ---------------------------------------------------------------------------

export const BUDGET_BLACKBOX_TOKENS = 900_000;   // 45%
export const BUDGET_BLACKBOX_CALLS = 54;          // 45% of 120
export const BUDGET_WHITEBOX_TOKENS = 700_000;    // 35%
export const BUDGET_WHITEBOX_CALLS = 42;          // 35% of 120

// ---------------------------------------------------------------------------
// Wall-clock timeouts (per agent job, not per turn)
// ---------------------------------------------------------------------------

export const BLACKBOX_TIMEOUT_MS = 45 * 60_000;  // 45 minutes
export const WHITEBOX_TIMEOUT_MS = 35 * 60_000;  // 35 minutes
export const CODE_MAP_TIMEOUT_MS = 10 * 60_000;  // 10 minutes
export const AUDIT_WATCHDOG_MS = 90 * 60_000;    // 90 minutes hard limit

// ---------------------------------------------------------------------------
// Degradation thresholds — docs/11 §6
// ---------------------------------------------------------------------------

export const DEGRADATION_THRESHOLDS = {
  /** Below this fraction: GREEN. Normal operation. */
  green: 0,
  /** At or above this fraction: YELLOW. Irreversibly marks audit degraded. */
  yellow: 0.50,
  /** At or above this fraction: RED. No new exploratory capabilities. */
  red: 0.80,
  /** At or above this fraction: EXCEEDED. Abort active call, partial audit. */
  exceeded: 1.00,
} as const;

export type DegradationState = 'green' | 'yellow' | 'red' | 'exceeded';

/**
 * Returns the degradation state for a given consumption fraction.
 * The fraction is consumed / limit (0..1+).
 */
export function degradationStateFor(fraction: number): DegradationState {
  if (fraction >= DEGRADATION_THRESHOLDS.exceeded) return 'exceeded';
  if (fraction >= DEGRADATION_THRESHOLDS.red) return 'red';
  if (fraction >= DEGRADATION_THRESHOLDS.yellow) return 'yellow';
  return 'green';
}

// ---------------------------------------------------------------------------
// Provider retry defaults — retry-strategy.ts owns the logic,
// these are the documented caps.
// ---------------------------------------------------------------------------

export const PROVIDER_MAX_RETRIES = 3;
export const PROVIDER_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

// ---------------------------------------------------------------------------
// Validation correction budget
// ---------------------------------------------------------------------------

/** Max correction turns per invalid capability call before blocking. */
export const MAX_VALIDATION_CORRECTIONS = 2;
