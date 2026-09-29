import OpenAI from 'openai';
import type { AIProvider, ProviderRequest, ProviderEvent } from './ai-provider.interface';
import type { ResponseInput, Tool, ResponseCreateParamsStreaming } from 'openai/resources/responses/responses';
export class OpenAIAdapter implements AIProvider {
  readonly providerName = 'openai' as const;
  constructor(private readonly client: OpenAI) {}
  async *runTurn(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    const input: ResponseInput = [];
    for (const m of request.messages) {
      if (m.role === 'system' || m.role === 'user') {
        input.push({ role: m.role === 'system' ? 'developer' : 'user', content: m.content.filter(b => b.type === 'text').map(b => b.text).join('\n') });
      } else {
        for (const block of m.content) {
          if (block.type === 'text') input.push({ role: 'assistant', content: block.text });
          else if (block.type === 'tool_use') input.push({ type: 'function_call', call_id: block.toolCallId, name: block.name, arguments: JSON.stringify(block.arguments) });
          else input.push({ type: 'function_call_output', call_id: block.toolCallId, output: block.content });
        }
      }
    }
    // Non-strict tool schemas retain optional fields. Kase validates every call.
    const tools: Tool[] = request.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
    const params: ResponseCreateParamsStreaming = { model: request.modelId, input, tools, max_output_tokens: request.maxOutputTokens,
      stream: true, store: false, parallel_tool_calls: false };
    const calls = new Map<string, {id: string; name: string; json: string}>();
    let ended = false;
    try {
      const stream = await this.client.responses.create(params, { signal });
      for await (const event of stream) {
        if (signal?.aborted) throw signal.reason;
        switch (event.type) {
          case 'response.output_text.delta': yield { type: 'text_delta', text: event.delta }; break;
          case 'response.refusal.delta': yield { type: 'refusal', reason: event.delta }; break;
          case 'response.output_item.added':
            if (event.item.type === 'function_call') calls.set(event.item.id!, { id: event.item.call_id, name: event.item.name, json: '' });
            break;
          case 'response.function_call_arguments.delta': {
            const call = calls.get(event.item_id);
            if (!call) throw new Error('Tool arguments without a function item');
            call.json += event.delta;
            break;
          }
          case 'response.function_call_arguments.done': {
            const call = calls.get(event.item_id);
            if (!call) throw new Error('Unknown function item');
            const args: unknown = JSON.parse(event.arguments);
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
            yield { type: 'tool_call', toolCallId: call.id, name: call.name, arguments: args as Record<string, unknown> };
            calls.delete(event.item_id);
            break;
          }
          case 'response.completed': case 'response.incomplete': {
            ended = true;
            const response = event.response;
            if (calls.size) throw new Error('Incomplete function arguments');
            if (response.usage) yield { type: 'usage', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, cachedTokens: response.usage.input_tokens_details.cached_tokens };
            yield { type: 'completion', stopReason: event.type === 'response.incomplete' ? 'max_tokens' : response.output.some(o => o.type === 'function_call') ? 'tool_use' : 'end_turn', providerRequestId: response.id };
            break;
          }
          case 'response.failed': throw new Error('Provider response failed');
          case 'error': throw new Error(event.message);
        }
      }
      if (!ended) throw new Error('Provider stream ended without completion');
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('Provider aborted');
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      yield { type: status === 429 || (status !== undefined && status >= 500) ? 'retryable_error' : 'permanent_error',
        code: status === 401 ? 'auth' : status === 404 ? 'model_not_found' : status === 400 ? 'malformed_request' : 'provider_error',
        message: 'OpenAI request failed' };
    }
  }
}

