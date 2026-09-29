/**
 * Provider-neutral AI interface (ADR-017).
 *
 * A single streaming method replaces the original per-task signatures.
 * The orchestration layer decides what to do with a model turn;
 * the provider adapter translates between Kase messages and vendor wire format.
 *
 * No provider-native response object escapes this boundary.
 */

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool_result';
  readonly content: readonly ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { readonly type: 'text'; readonly text: string; readonly cacheable?: boolean }
  | { readonly type: 'tool_use'; readonly toolCallId: string; readonly name: string; readonly arguments: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly toolCallId: string; readonly content: string; readonly isError?: boolean };

export interface ProviderToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // JSON Schema
}

export interface BudgetHandle {
  readonly auditId: string;
  readonly agentRole: 'blackbox' | 'whitebox';
  readonly turnSequence: number;
}

export interface ProviderRequest {
  readonly modelId: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly ProviderToolSchema[];
  readonly maxOutputTokens: number;
  readonly budgetHandle: BudgetHandle;
  /** Temperature — default 0 for maximum determinism. */
  readonly temperature?: number;
}

// ---------------------------------------------------------------------------
// Events (discriminated union)
// ---------------------------------------------------------------------------

export type ProviderEvent =
  | ProviderTextDelta
  | ProviderToolCall
  | ProviderUsage
  | ProviderCompletion
  | ProviderRefusal
  | ProviderRetryableError
  | ProviderPermanentError;

export interface ProviderTextDelta {
  readonly type: 'text_delta';
  readonly text: string;
}

export interface ProviderToolCall {
  readonly type: 'tool_call';
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ProviderUsage {
  readonly type: 'usage';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
}

export interface ProviderCompletion {
  readonly type: 'completion';
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  readonly providerRequestId?: string;
}

export interface ProviderRefusal {
  readonly type: 'refusal';
  readonly reason: string;
  readonly providerRequestId?: string;
}

export interface ProviderRetryableError {
  readonly type: 'retryable_error';
  readonly code: string;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export interface ProviderPermanentError {
  readonly type: 'permanent_error';
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  readonly providerName: 'anthropic' | 'openai';

  /**
   * Send a turn to the model and stream back events.
   *
   * The caller owns retry logic (via retry-strategy.ts). The adapter
   * translates vendor-specific errors into ProviderRetryableError or
   * ProviderPermanentError and yields them as events rather than throwing.
   */
  runTurn(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}
