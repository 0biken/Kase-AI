import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { OpenAIAdapter } from './openai.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { ProviderRequest } from './ai-provider.interface';

const request: ProviderRequest = {
  modelId: 'fixture-pinned-model', maxOutputTokens: 128,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the fixture record.' }] }],
  tools: [{ name: 'read_record', description: 'Read a fixture record', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }],
  budgetHandle: { auditId: 'fixture-audit', agentRole: 'blackbox', turnSequence: 0 },
};
async function collect(events: AsyncIterable<unknown>) {
  const output: any[] = []; for await (const event of events) output.push(event); return output;
}
function send(res: ServerResponse, events: any[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

describe('installed SDKs against real local protocol servers', () => {
  let server: Server;
  let url: string;
  let handler: (req: IncomingMessage, res: ServerResponse, body: any) => void;
  const received: any[] = [];
  beforeEach(async () => {
    received.length = 0;
    server = createServer(async (req, res) => {
      try {
        const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
        received.push({ path: req.url, body, headers: req.headers });
        handler(req, res, body);
      } catch { res.writeHead(400); res.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('OpenAI serializes Responses tools/results and parses a two-turn SSE exchange', async () => {
    handler = (_req, res, body) => {
      const second = body.input.some((item: any) => item.type === 'function_call_output');
      send(res, second ? [
        { type: 'response.output_text.delta', delta: 'Observed record.' },
        { type: 'response.completed', response: { id: 'response-2', output: [], usage: { input_tokens: 9, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } },
      ] : [
        { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_record' } },
        { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"id":' },
        { type: 'response.function_call_arguments.done', item_id: 'item-1', arguments: '{"id":"record-1"}' },
        { type: 'response.completed', response: { id: 'response-1', output: [{ type: 'function_call' }], usage: { input_tokens: 20, output_tokens: 5, input_tokens_details: { cached_tokens: 7 } } } },
      ]);
    };
    const adapter = new OpenAIAdapter(new OpenAI({ apiKey: 'openai-fixture-only', baseURL: `${url}/v1`, maxRetries: 0 }));
    const first = await collect(adapter.runTurn(request));
    expect(first[0]).toMatchObject({ type: 'tool_call', toolCallId: 'call-1', arguments: { id: 'record-1' } });
    const second = await collect(adapter.runTurn({ ...request, messages: [...request.messages,
      { role: 'assistant', content: [{ type: 'tool_use', toolCallId: 'call-1', name: 'read_record', arguments: { id: 'record-1' } }] },
      { role: 'tool_result', content: [{ type: 'tool_result', toolCallId: 'call-1', content: 'record-1 contents' }] },
    ] }));
    expect(received.map(r => r.path)).toEqual(['/v1/responses', '/v1/responses']);
    expect(received[0].body).toMatchObject({ model: request.modelId, max_output_tokens: 128, parallel_tool_calls: false, store: false, tools: [{ type: 'function', name: 'read_record' }] });
    expect(received[1].body.input).toContainEqual({ type: 'function_call_output', call_id: 'call-1', output: 'record-1 contents' });
    expect(received[0].headers.authorization).toBe('Bearer openai-fixture-only');
    expect(received[0].headers['x-api-key']).toBeUndefined();
    expect(second).toContainEqual({ type: 'usage', inputTokens: 9, outputTokens: 3, cachedTokens: 4 });
    expect(second.at(-1)).toMatchObject({ type: 'completion', stopReason: 'end_turn' });
  });

  it('Anthropic serializes Messages tools/results and parses cache usage over HTTP', async () => {
    handler = (_req, res, body) => {
      const second = body.messages.at(-1).content.some((item: any) => item.type === 'tool_result');
      send(res, [
        { type: 'message_start', message: { id: second ? 'message-2' : 'message-1', type: 'message', role: 'assistant', content: [], model: request.modelId, usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 4 } } },
        ...(second ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Observed record.' } }] : [
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'read_record', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"id":"record-1"}' } },
          { type: 'content_block_stop', index: 0 },
        ]),
        { type: 'message_delta', delta: { stop_reason: second ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]);
    };
    const adapter = new AnthropicAdapter(new Anthropic({ apiKey: 'anthropic-fixture-only', baseURL: url, maxRetries: 0 }));
    const first = await collect(adapter.runTurn(request));
    expect(first[0]).toMatchObject({ type: 'tool_call', toolCallId: 'tool-1', arguments: { id: 'record-1' } });
    const second = await collect(adapter.runTurn({ ...request, messages: [...request.messages,
      { role: 'assistant', content: [{ type: 'tool_use', toolCallId: 'tool-1', name: 'read_record', arguments: { id: 'record-1' } }] },
      { role: 'tool_result', content: [{ type: 'tool_result', toolCallId: 'tool-1', content: 'record-1 contents' }] },
    ] }));
    expect(received.map(r => r.path)).toEqual(['/v1/messages', '/v1/messages']);
    expect(received[0].body).toMatchObject({ model: request.modelId, max_tokens: 128, tool_choice: { type: 'auto', disable_parallel_tool_use: true } });
    expect(received[1].body.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'record-1 contents' }] });
    expect(received[0].headers['x-api-key']).toBe('anthropic-fixture-only');
    expect(received[0].headers.authorization).toBeUndefined();
    expect(second).toContainEqual({ type: 'usage', inputTokens: 16, outputTokens: 5, cachedTokens: 6 });
    expect(second.at(-1)).toMatchObject({ type: 'completion', stopReason: 'end_turn' });
  });

  it.each(['openai', 'anthropic'])('%s exposes a real HTTP 429 without hidden SDK retries', async provider => {
    handler = (_req, res) => { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'fixture limit' } })); };
    const adapter = provider === 'openai'
      ? new OpenAIAdapter(new OpenAI({ apiKey: 'fixture-only', baseURL: url, maxRetries: 0 }))
      : new AnthropicAdapter(new Anthropic({ apiKey: 'fixture-only', baseURL: url, maxRetries: 0 }));
    expect(await collect(adapter.runTurn(request))).toEqual([expect.objectContaining({ type: 'retryable_error' })]);
    expect(received).toHaveLength(1);
  });

  function adapterFor(provider: string) {
    return provider === 'openai'
      ? new OpenAIAdapter(new OpenAI({ apiKey: 'fixture-only', baseURL: url, maxRetries: 0 }))
      : new AnthropicAdapter(new Anthropic({ apiKey: 'fixture-only', baseURL: url, maxRetries: 0 }));
  }

  it.each(['openai', 'anthropic'])('%s aborts an in-flight HTTP stream without retrying', async provider => {
    const controller = new AbortController();
    const reason = new Error('fixture cancellation');
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      controller.abort(reason);
    };
    await expect(collect(adapterFor(provider).runTurn(request, controller.signal))).rejects.toBe(reason);
    expect(received).toHaveLength(1);
  });

  it.each(['openai', 'anthropic'])('%s rejects malformed SSE without leaking server content', async provider => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {fixture-secret-invalid-json\n\n');
    };
    const events = await collect(adapterFor(provider).runTurn(request));
    expect(events).toEqual([expect.objectContaining({ type: 'permanent_error' })]);
    expect(JSON.stringify(events)).not.toContain('fixture-secret');
  });

  it.each(['openai', 'anthropic'])('%s rejects EOF without a terminal event', async provider => {
    handler = (_req, res) => send(res, provider === 'openai'
      ? [{ type: 'response.output_text.delta', delta: 'partial' }]
      : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }]);
    const events = await collect(adapterFor(provider).runTurn(request));
    expect(events).toContainEqual({ type: 'text_delta', text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'permanent_error' });
    expect(events.some(event => event.type === 'completion')).toBe(false);
  });

  it.each(['openai', 'anthropic'])('%s preserves refusal and usage through the SDK', async provider => {
    handler = (_req, res) => send(res, provider === 'openai' ? [
      { type: 'response.refusal.delta', delta: 'Cannot comply' },
      { type: 'response.completed', response: { id: 'refused', output: [], usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } },
    ] : [
      { type: 'message_start', message: { id: 'refused', usage: { input_tokens: 10 } } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
    const events = await collect(adapterFor(provider).runTurn(request));
    expect(events).toContainEqual(expect.objectContaining({ type: 'refusal' }));
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 2, cachedTokens: 0 });
  });

  it.each(['openai', 'anthropic'])('%s preserves output truncation and the requested output cap', async provider => {
    handler = (_req, res) => send(res, provider === 'openai' ? [
      { type: 'response.incomplete', response: { id: 'limited', output: [], incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 128, input_tokens_details: { cached_tokens: 0 } } } },
    ] : [
      { type: 'message_start', message: { id: 'limited', usage: { input_tokens: 10 } } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 128 } },
      { type: 'message_stop' },
    ]);
    const events = await collect(adapterFor(provider).runTurn(request));
    expect(events.at(-1)).toMatchObject({ type: 'completion', stopReason: 'max_tokens' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 128, cachedTokens: 0 });
    expect(received[0].body[provider === 'openai' ? 'max_output_tokens' : 'max_tokens']).toBe(128);
  });
});
