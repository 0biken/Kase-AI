import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, ProviderRequest, ProviderEvent, ProviderContentBlock } from './ai-provider.interface';
export class AnthropicAdapter implements AIProvider {
  readonly providerName = 'anthropic' as const;
  constructor(private readonly client: Anthropic) {}
  async *runTurn(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    const mapBlock = (b: ProviderContentBlock): Anthropic.ContentBlockParam => {
      if (b.type === 'text') return { type: 'text', text: b.text, ...(b.cacheable ? { cache_control: { type: 'ephemeral' as const } } : {}) };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.toolCallId, name: b.name, input: b.arguments };
      return { type: 'tool_result', tool_use_id: b.toolCallId, content: b.content, is_error: b.isError };
    };
    const messages: Anthropic.MessageParam[] = request.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.map(mapBlock) }));
    const system: Anthropic.TextBlockParam[] = request.messages.filter(m => m.role === 'system').flatMap(m => m.content).map(b => {
      if (b.type !== 'text') throw new Error('Invalid system block');
      return { type: 'text', text: b.text, ...(b.cacheable ? { cache_control: { type: 'ephemeral' as const } } : {}) };
    });
    const tools: Anthropic.Tool[] = request.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
    let complete = false;
    const calls = new Map<number, { id: string; name: string; json: string; initial: unknown }>();
    try {
      const stream = await this.client.messages.create({ model: request.modelId, max_tokens: request.maxOutputTokens,
        messages, system, tools, ...(tools.length ? { tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true } } : {}),
        stream: true, temperature: request.temperature ?? 0 }, { signal });
      let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';
      let requestId: string | undefined;
      for await (const event of stream) {
        if (signal?.aborted) throw signal.reason;
        if (event.type === 'message_start') {
          requestId = event.message.id;
          inputTokens = event.message.usage.input_tokens;
          cachedTokens = (event.message.usage.cache_creation_input_tokens ?? 0) + (event.message.usage.cache_read_input_tokens ?? 0);
          inputTokens += cachedTokens;
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          calls.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '', initial: event.content_block.input });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text_delta', text: event.delta.text };
          else if (event.delta.type === 'input_json_delta') {
            const call = calls.get(event.index);
            if (!call) throw new Error('Tool delta without tool');
            call.json += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          const call = calls.get(event.index);
          if (call) {
            const args: unknown = call.json ? JSON.parse(call.json) : call.initial;
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
            yield { type: 'tool_call', toolCallId: call.id, name: call.name, arguments: args as Record<string, unknown> };
            calls.delete(event.index);
          }
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
          const reason = event.delta.stop_reason;
          stopReason = reason === 'tool_use' ? 'tool_use' : reason === 'max_tokens' ? 'max_tokens' : 'end_turn';
          if (String(reason) === 'refusal') yield { type: 'refusal', reason: 'Provider refused the request' };
        } else if (event.type === 'message_stop') {
          if (calls.size) throw new Error('Incomplete tool arguments');
          complete = true;
          yield { type: 'usage', inputTokens, outputTokens, cachedTokens };
          yield { type: 'completion', stopReason, providerRequestId: requestId };
        }
      }
      if (!complete) throw new Error('Provider stream ended without completion');
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('Provider aborted');
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      yield { type: status === 429 || (status !== undefined && status >= 500) ? 'retryable_error' : 'permanent_error',
        code: status === 401 ? 'auth' : status === 404 ? 'model_not_found' : status === 400 ? 'malformed_request' : 'provider_error',
        message: 'Anthropic request failed' };
    }
  }
}

