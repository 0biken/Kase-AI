import { ApiError } from '@google/genai';
import { GeminiAdapter } from './gemini.adapter';
import { ProviderResolver } from './provider-resolver.service';
import { ProviderRequest } from './ai-provider.interface';
import { ToolCallSchema } from './provider-event.schema';

const request: ProviderRequest = { modelId: 'gemini-4-carbon',
  messages: [{ role: 'system', content: [{ type: 'text', text: 'policy', cacheable: true }] }, { role: 'user', content: [{ type: 'text', text: 'task' }] }],
  tools: [{ name: 'read_record', description: 'Read fixture', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }],
  maxOutputTokens: 256, budgetHandle: { auditId: 'audit', agentRole: 'blackbox', turnSequence: 0 } };
async function* stream(chunks: unknown[]) { for (const c of chunks) yield c; }
async function collect(events: AsyncIterable<unknown>) { const out: any[] = []; for await (const e of events) out.push(e); return out; }
const fake = (generateContentStream: jest.Mock) => new GeminiAdapter({ models: { generateContentStream } } as any);
const usage = { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 30, cachedContentTokenCount: 20 };

describe('Gemini provider wire contract', () => {
  it('sends Kase-only function tools, system instruction, output cap and temperature 0', async () => {
    const gen = jest.fn().mockResolvedValue(stream([{ responseId: 'r1', candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }], usageMetadata: usage }]));
    await collect(fake(gen).runTurn(request));
    const params = gen.mock.calls[0][0];
    expect(params.model).toBe('gemini-4-carbon');
    expect(params.contents).toEqual([{ role: 'user', parts: [{ text: 'task' }] }]);
    expect(params.config).toMatchObject({ systemInstruction: 'policy', maxOutputTokens: 256, temperature: 0,
      tools: [{ functionDeclarations: [{ name: 'read_record', description: 'Read fixture', parametersJsonSchema: request.tools[0].inputSchema }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } } });
    expect(params.config.tools).toHaveLength(1);
  });

  it('maps a tool call with thought signature, counts thinking tokens as output, and round-trips the signature', async () => {
    const gen = jest.fn().mockResolvedValue(stream([
      { responseId: 'r1', candidates: [{ content: { parts: [{ text: 'internal', thought: true }] } }] },
      { responseId: 'r1', candidates: [{ content: { parts: [{ functionCall: { id: 'fc1', name: 'read_record', args: { id: 'one' } }, thoughtSignature: 'sig-abc' }] }, finishReason: 'STOP' }], usageMetadata: usage },
    ]));
    const adapter = fake(gen);
    const events = await collect(adapter.runTurn(request));
    expect(events).toEqual([
      { type: 'tool_call', toolCallId: 'fc1', name: 'read_record', arguments: { id: 'one' }, providerState: 'sig-abc' },
      { type: 'usage', inputTokens: 50, outputTokens: 40, cachedTokens: 20 },
      { type: 'completion', stopReason: 'tool_use', providerRequestId: 'r1' },
    ]);
    expect(ToolCallSchema.safeParse(events[0]).success).toBe(true);

    gen.mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: usage }]));
    await collect(adapter.runTurn({ ...request, messages: [...request.messages,
      { role: 'assistant', content: [{ type: 'tool_use', toolCallId: 'fc1', name: 'read_record', arguments: { id: 'one' }, providerState: 'sig-abc' }] },
      { role: 'tool_result', content: [{ type: 'tool_result', toolCallId: 'fc1', content: 'observation', isError: true }] }] }));
    expect(gen.mock.calls[1][0].contents.slice(-2)).toEqual([
      { role: 'model', parts: [{ functionCall: { id: 'fc1', name: 'read_record', args: { id: 'one' } }, thoughtSignature: 'sig-abc' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'fc1', name: 'read_record', response: { error: 'observation' } } }] },
    ]);
  });

  it('invents a local call ID when Gemini omits one and never sends it back', async () => {
    const gen = jest.fn().mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ functionCall: { name: 'read_record', args: { id: 'x' } } }] }, finishReason: 'STOP' }], usageMetadata: usage }]));
    const adapter = fake(gen);
    const [call] = await collect(adapter.runTurn(request));
    expect(call.toolCallId).toMatch(/^kase-local-/);
    gen.mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: usage }]));
    await collect(adapter.runTurn({ ...request, messages: [...request.messages,
      { role: 'assistant', content: [{ type: 'tool_use', toolCallId: call.toolCallId, name: 'read_record', arguments: { id: 'x' } }] },
      { role: 'tool_result', content: [{ type: 'tool_result', toolCallId: call.toolCallId, content: 'r' }] }] }));
    const sent = JSON.stringify(gen.mock.calls[1][0].contents);
    expect(sent).not.toContain('kase-local-');
  });

  it('rejects malformed function arguments', async () => {
    const gen = jest.fn().mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ functionCall: { id: 'f', name: 'read_record', args: ['bad'] } }] }, finishReason: 'STOP' }], usageMetadata: usage }]));
    const result = await collect(fake(gen).runTurn(request));
    expect(result).toHaveLength(1); expect(result[0].type).toBe('permanent_error');
  });

  it('preserves safety refusal and truncation', async () => {
    const refused = await collect(fake(jest.fn().mockResolvedValue(stream([{ candidates: [{ finishReason: 'SAFETY' }], usageMetadata: usage }]))).runTurn(request));
    expect(refused[0]).toMatchObject({ type: 'refusal' });
    const blocked = await collect(fake(jest.fn().mockResolvedValue(stream([{ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: usage }]))).runTurn(request));
    expect(blocked[0]).toMatchObject({ type: 'refusal' });
    const truncated = await collect(fake(jest.fn().mockResolvedValue(stream([{ candidates: [{ content: { parts: [{ text: 'par' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: usage }]))).runTurn(request));
    expect(truncated.at(-1)).toMatchObject({ type: 'completion', stopReason: 'max_tokens' });
  });

  it('rejects interrupted streams and abnormal stops instead of reporting success', async () => {
    expect((await collect(fake(jest.fn().mockResolvedValue(stream([]))).runTurn(request)))[0].type).toBe('permanent_error');
    expect((await collect(fake(jest.fn().mockResolvedValue(stream([{ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }], usageMetadata: usage }]))).runTurn(request)))[0].type).toBe('permanent_error');
  });

  it('classifies API errors: 429/5xx retryable, auth and model errors permanent', async () => {
    const run = async (status: number) => (await collect(fake(jest.fn().mockRejectedValue(new ApiError({ message: 'x', status }))).runTurn(request)))[0];
    expect(await run(429)).toMatchObject({ type: 'retryable_error' });
    expect(await run(503)).toMatchObject({ type: 'retryable_error' });
    expect(await run(403)).toMatchObject({ type: 'permanent_error', code: 'auth' });
    expect(await run(404)).toMatchObject({ type: 'permanent_error', code: 'model_not_found' });
  });

  it('propagates abort instead of turning it into completion', async () => {
    const controller = new AbortController(); controller.abort(new Error('test abort'));
    await expect(collect(fake(jest.fn().mockRejectedValue(new Error('aborted'))).runTurn(request, controller.signal))).rejects.toThrow('test abort');
  });
});

describe('Gemini provider resolution', () => {
  const previous = { ...process.env };
  afterEach(() => { process.env = { ...previous }; });
  const snapshot = { provider: 'gemini', credentialMode: 'project_secret', credentialSecretId: 's', credentialSecretVersion: 3, audit: { projectId: 'p' } };

  it('never falls back to the platform key for a revoked gemini secret', async () => {
    process.env.GEMINI_API_KEY = 'must-not-use';
    const prisma = { auditAiSnapshot: { findUniqueOrThrow: async () => snapshot }, secret: { findFirst: jest.fn().mockResolvedValue(null) } };
    const secrets = { resolveForWorker: jest.fn() };
    await expect(new ProviderResolver(prisma as any, secrets as any).forAudit('a')).rejects.toThrow('revoked');
    expect(prisma.secret.findFirst.mock.calls[0][0].where.kind).toBe('gemini_api_key');
    expect(secrets.resolveForWorker).not.toHaveBeenCalled();
  });

  it('pins the secret version, enforces the router allowlist and the env-proxy requirement', async () => {
    const prisma = { auditAiSnapshot: { findUniqueOrThrow: async () => snapshot }, secret: { findFirst: async () => ({ id: 's' }) } };
    const secrets = { resolveForWorker: jest.fn().mockResolvedValue('test-value') };
    Object.assign(process.env, { KASE_GEMINI_BASE_URL: 'http://fixture-router:3000', KASE_AGENT_ROUTER_HOSTS: 'fixture-router', NODE_ENV: 'test' });
    delete process.env.KASE_AGENT_EGRESS_PROXY;
    const provider = await new ProviderResolver(prisma as any, secrets as any).forAudit('a');
    expect(provider.providerName).toBe('gemini'); expect(secrets.resolveForWorker).toHaveBeenCalledWith('p', 's', 3);

    process.env.KASE_AGENT_EGRESS_PROXY = 'http://agent-egress-proxy:3128';
    delete process.env.NODE_USE_ENV_PROXY;
    await expect(new ProviderResolver(prisma as any, secrets as any).forAudit('a')).rejects.toThrow('NODE_USE_ENV_PROXY');
    Object.assign(process.env, { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://agent-egress-proxy:3128' });
    await expect(new ProviderResolver(prisma as any, secrets as any).forAudit('a')).resolves.toBeDefined();

    process.env.KASE_AGENT_ROUTER_HOSTS = 'another-host';
    await expect(new ProviderResolver(prisma as any, secrets as any).forAudit('a')).rejects.toThrow('not allowed');
  });
});
