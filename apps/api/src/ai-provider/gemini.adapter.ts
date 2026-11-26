import { ApiError, FinishReason, FunctionCallingConfigMode, type GoogleGenAI, type Content, type Part, type GenerateContentParameters } from '@google/genai';
import { ulid } from 'ulid';
import type { AIProvider, ProviderRequest, ProviderEvent } from './ai-provider.interface';

/** Prefix for call IDs Kase invents when Gemini omits one; such IDs are never sent back to the API. */
const LOCAL_ID_PREFIX = 'kase-local-';
const REFUSAL_REASONS = new Set<string>([FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII]);

/**
 * Gemini API adapter (ADR-017). Only Kase-defined function tools are offered;
 * Google-hosted tools (search, code execution, URL context) are never enabled.
 * Thought signatures are returned as opaque `providerState` and echoed back
 * on the matching functionCall part, which Gemini requires for multi-turn tool use.
 */
export class GeminiAdapter implements AIProvider {
  readonly providerName = 'gemini' as const;
  constructor(private readonly client: Pick<GoogleGenAI, 'models'>) {}

  async *runTurn(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    const toolNames = new Map<string, string>();
    const systemText: string[] = [];
    const contents: Content[] = [];
    for (const m of request.messages) {
      if (m.role === 'system') {
        for (const b of m.content) { if (b.type !== 'text') throw new Error('Invalid system block'); systemText.push(b.text); }
        continue;
      }
      const parts: Part[] = m.content.map((b): Part => {
        if (b.type === 'text') return { text: b.text };
        if (b.type === 'tool_use') {
          toolNames.set(b.toolCallId, b.name);
          return { functionCall: { ...(b.toolCallId.startsWith(LOCAL_ID_PREFIX) ? {} : { id: b.toolCallId }), name: b.name, args: b.arguments },
            ...(b.providerState ? { thoughtSignature: b.providerState } : {}) };
        }
        const name = toolNames.get(b.toolCallId);
        if (!name) throw new Error('Tool result without a matching tool call');
        return { functionResponse: { ...(b.toolCallId.startsWith(LOCAL_ID_PREFIX) ? {} : { id: b.toolCallId }), name,
          response: b.isError ? { error: b.content } : { output: b.content } } };
      });
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    const params: GenerateContentParameters = {
      model: request.modelId,
      contents,
      config: {
        ...(systemText.length ? { systemInstruction: systemText.join('\n') } : {}),
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature ?? 0,
        abortSignal: signal,
        ...(request.tools.length ? {
          tools: [{ functionDeclarations: request.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        } : {}),
      },
    };
    let finish: string | undefined;
    let sawCall = false;
    let requestId: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; cachedTokens: number } | undefined;
    try {
      const stream = await this.client.models.generateContentStream(params);
      for await (const chunk of stream) {
        if (signal?.aborted) throw signal.reason;
        requestId = chunk.responseId ?? requestId;
        if (chunk.promptFeedback?.blockReason) { yield { type: 'refusal', reason: 'Provider blocked the prompt', providerRequestId: requestId }; finish = 'BLOCKED'; }
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought) continue;
          if (part.functionCall) {
            const args: unknown = part.functionCall.args ?? {};
            if (!part.functionCall.name || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
            sawCall = true;
            yield { type: 'tool_call', toolCallId: part.functionCall.id || LOCAL_ID_PREFIX + ulid(), name: part.functionCall.name,
              arguments: args as Record<string, unknown>, ...(part.thoughtSignature ? { providerState: part.thoughtSignature } : {}) };
          } else if (part.text) yield { type: 'text_delta', text: part.text };
        }
        if (candidate?.finishReason) finish = candidate.finishReason;
        const u = chunk.usageMetadata;
        if (u) usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          cachedTokens: u.cachedContentTokenCount ?? 0 };
      }
      if (!finish) throw new Error('Provider stream ended without completion');
      if (REFUSAL_REASONS.has(finish)) yield { type: 'refusal', reason: 'Provider refused the request', providerRequestId: requestId };
      else if (finish !== 'BLOCKED' && finish !== FinishReason.STOP && finish !== FinishReason.MAX_TOKENS) throw new Error('Provider stopped abnormally');
      if (!usage) throw new Error('Provider did not report usage');
      yield { type: 'usage', ...usage };
      yield { type: 'completion', stopReason: finish === FinishReason.MAX_TOKENS ? 'max_tokens' : sawCall ? 'tool_use' : 'end_turn', providerRequestId: requestId };
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('Provider aborted');
      const status = error instanceof ApiError ? error.status : undefined;
      yield { type: status === 429 || (status !== undefined && status >= 500) ? 'retryable_error' : 'permanent_error',
        code: status === 401 || status === 403 ? 'auth' : status === 404 ? 'model_not_found' : status === 400 ? 'malformed_request' : 'provider_error',
        message: 'Gemini request failed' };
    }
  }
}
