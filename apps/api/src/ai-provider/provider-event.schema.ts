import { z } from 'zod';

export const TextDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const ToolCallSchema = z.object({
  type: z.literal('tool_call'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export const UsageSchema = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
});

export const CompletionSchema = z.object({
  type: z.literal('completion'),
  stopReason: z.enum(['end_turn', 'tool_use', 'max_tokens']),
  providerRequestId: z.string().optional(),
});

export const RefusalSchema = z.object({
  type: z.literal('refusal'),
  reason: z.string(),
  providerRequestId: z.string().optional(),
});

export const RetryableErrorSchema = z.object({
  type: z.literal('retryable_error'),
  code: z.string(),
  message: z.string(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

export const PermanentErrorSchema = z.object({
  type: z.literal('permanent_error'),
  code: z.string(),
  message: z.string(),
});

export const ProviderEventSchema = z.discriminatedUnion('type', [
  TextDeltaSchema,
  ToolCallSchema,
  UsageSchema,
  CompletionSchema,
  RefusalSchema,
  RetryableErrorSchema,
  PermanentErrorSchema,
]);

export type ValidatedProviderEvent = z.infer<typeof ProviderEventSchema>;
