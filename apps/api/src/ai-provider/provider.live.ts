/**
 * G6 part A — live provider tool-exchange proof (M4 agent runtime).
 *
 * Runs only via `pnpm --filter @kase/api test:live` (jest.live.config.js); the
 * normal suite matches `*.spec.ts` only. Needs no Docker: plain Node + real HTTPS.
 *
 * For each provider in [gemini, KASE_M4_SECOND_PROVIDER] it drives a two-turn
 * exchange with one tool through the real adapter and records the outcome in
 * `.m4-proof/live/G6-exchange.json` at the repo root. Missing configuration
 * fails the test (never skips). One attempt per provider; no retries.
 *
 * The record never contains keys, base URLs, prompts or response text.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { GeminiAdapter } from './gemini.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import type { AIProvider, ProviderEvent, ProviderMessage, ProviderRequest, ProviderToolCall, ProviderUsage } from './ai-provider.interface';
import { ProviderEventSchema } from './provider-event.schema';

type LiveProvider = 'gemini' | 'anthropic' | 'openai';
const KEY_ENV: Record<LiveProvider, string> = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
const REPO_ROOT = resolve(__dirname, '../../../..');
const OUT_FILE = resolve(REPO_ROOT, '.m4-proof/live/G6-exchange.json');

interface ProviderRecord {
  provider: string;
  modelId: string | null;
  gitRevision: string;
  startedAt: string;
  endedAt: string | null;
  usage: { turn: number; inputTokens: number; outputTokens: number; cachedTokens: number }[];
  passed: boolean;
  /** Short failure category only; never provider message text. */
  failure?: string;
}

const records: ProviderRecord[] = [];

function gitRevision(): string {
  try { return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
}

function requireEnv(name: string, provider: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`G6 live proof (${provider}): required environment variable ${name} is not set`);
  return value;
}

function buildAdapter(provider: LiveProvider): { adapter: AIProvider; modelId: string } {
  const P = provider.toUpperCase();
  const baseURL = requireEnv(`KASE_${P}_BASE_URL`, provider);
  const modelId = requireEnv(`KASE_M4_${P}_MODEL_ID`, provider);
  const apiKey = requireEnv(KEY_ENV[provider], provider);
  const allowlist = requireEnv('KASE_AGENT_ROUTER_HOSTS', provider).split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  let hostname: string;
  try { hostname = new URL(baseURL).hostname.toLowerCase(); }
  catch { throw new Error(`G6 live proof (${provider}): KASE_${P}_BASE_URL is not a valid URL`); }
  if (!allowlist.includes(hostname)) {
    throw new Error(`G6 live proof (${provider}): host of KASE_${P}_BASE_URL is not listed in KASE_AGENT_ROUTER_HOSTS`);
  }
  if (provider === 'gemini') {
    return { modelId, adapter: new GeminiAdapter(new GoogleGenAI({ apiKey, httpOptions: { baseUrl: baseURL, timeout: 60000, retryOptions: { attempts: 1 } } })) };
  }
  if (provider === 'anthropic') return { modelId, adapter: new AnthropicAdapter(new Anthropic({ apiKey, baseURL, maxRetries: 0 })) };
  return { modelId, adapter: new OpenAIAdapter(new OpenAI({ apiKey, baseURL, maxRetries: 0 })) };
}

function secondProvider(): string {
  return process.env.KASE_M4_SECOND_PROVIDER?.trim().toLowerCase() || '<KASE_M4_SECOND_PROVIDER unset>';
}

const TOOL = { name: 'read_record', description: 'Read a fixture record by id.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } };
const SYSTEM = 'You are a test harness agent. First call the read_record tool exactly once with id "inv_1001". '
  + 'After you receive the tool result, reply with one short sentence summarising the record and do not call any tool again.';

async function collectValidated(adapter: AIProvider, request: ProviderRequest, provider: string, turn: number): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of adapter.runTurn(request)) {
    const parsed = ProviderEventSchema.safeParse(event);
    if (!parsed.success) throw new Error(`G6 live proof (${provider}) turn ${turn}: event failed ProviderEventSchema (type=${String((event as { type?: unknown }).type)})`);
    events.push(event);
  }
  return events;
}

function shape(events: ProviderEvent[]): string { return events.map(e => e.type).join(','); }

function assertNoErrors(events: ProviderEvent[], provider: string, turn: number): void {
  const bad = events.find(e => e.type === 'refusal' || e.type === 'retryable_error' || e.type === 'permanent_error');
  if (bad) {
    const detail = bad.type === 'refusal' ? 'refusal' : `${bad.type}:${bad.code}`;
    throw new Error(`G6 live proof (${provider}) turn ${turn}: provider returned ${detail}`);
  }
}

describe('G6 part A — live provider tool exchange', () => {
  afterAll(() => {
    mkdirSync(resolve(OUT_FILE, '..'), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({ gate: 'G6', part: 'A', generatedAt: new Date().toISOString(),
      passed: records.length === 2 && records.every(r => r.passed), providers: records }, null, 2) + '\n');
  });

  it.each(['gemini', secondProvider()])('%s completes a two-turn tool exchange', async (name) => {
    const record: ProviderRecord = { provider: name, modelId: null, gitRevision: gitRevision(), startedAt: new Date().toISOString(),
      endedAt: null, usage: [], passed: false };
    records.push(record);
    try {
      if (name !== 'gemini' && name !== 'anthropic' && name !== 'openai') {
        throw new Error('G6 live proof: KASE_M4_SECOND_PROVIDER must be set to "anthropic" or "openai"');
      }
      const provider = name as LiveProvider;
      const { adapter, modelId } = buildAdapter(provider);
      record.modelId = modelId;

      const messages: ProviderMessage[] = [
        { role: 'system', content: [{ type: 'text', text: SYSTEM }] },
        { role: 'user', content: [{ type: 'text', text: 'Look up record inv_1001.' }] },
      ];
      const base = { modelId, tools: [TOOL], maxOutputTokens: 1024, temperature: 0 };

      // Turn 1: exactly one tool_call + usage + completion(tool_use).
      const t1 = await collectValidated(adapter, { ...base, messages, budgetHandle: { auditId: 'g6-live', agentRole: 'blackbox', turnSequence: 0 } }, provider, 1);
      assertNoErrors(t1, provider, 1);
      const calls = t1.filter((e): e is ProviderToolCall => e.type === 'tool_call');
      const u1 = t1.filter((e): e is ProviderUsage => e.type === 'usage');
      const c1 = t1.filter(e => e.type === 'completion');
      if (calls.length !== 1 || u1.length !== 1 || c1.length !== 1) throw new Error(`G6 live proof (${provider}) turn 1: unexpected event shape [${shape(t1)}]`);
      record.usage.push({ turn: 1, inputTokens: u1[0].inputTokens, outputTokens: u1[0].outputTokens, cachedTokens: u1[0].cachedTokens });
      const completion1 = c1[0];
      if (completion1.type !== 'completion' || completion1.stopReason !== 'tool_use') throw new Error(`G6 live proof (${provider}) turn 1: expected stopReason tool_use`);
      const call = calls[0];
      if (call.name !== 'read_record' || call.arguments.id !== 'inv_1001') throw new Error(`G6 live proof (${provider}) turn 1: tool call did not request read_record(inv_1001)`);

      // Turn 2: echo the assistant tool_use (with providerState) and a tool_result; must end_turn.
      messages.push(
        { role: 'assistant', content: [{ type: 'tool_use', toolCallId: call.toolCallId, name: call.name, arguments: call.arguments,
          ...(call.providerState ? { providerState: call.providerState } : {}) }] },
        { role: 'tool_result', content: [{ type: 'tool_result', toolCallId: call.toolCallId,
          content: JSON.stringify({ id: 'inv_1001', kind: 'invoice', status: 'paid', amount: 1250, currency: 'EUR' }) }] },
      );
      const t2 = await collectValidated(adapter, { ...base, messages, budgetHandle: { auditId: 'g6-live', agentRole: 'blackbox', turnSequence: 1 } }, provider, 2);
      assertNoErrors(t2, provider, 2);
      const u2 = t2.filter((e): e is ProviderUsage => e.type === 'usage');
      const c2 = t2.filter(e => e.type === 'completion');
      if (u2.length !== 1 || c2.length !== 1 || t2.some(e => e.type === 'tool_call')) throw new Error(`G6 live proof (${provider}) turn 2: unexpected event shape [${shape(t2)}]`);
      record.usage.push({ turn: 2, inputTokens: u2[0].inputTokens, outputTokens: u2[0].outputTokens, cachedTokens: u2[0].cachedTokens });
      const completion2 = c2[0];
      if (completion2.type !== 'completion' || completion2.stopReason !== 'end_turn') throw new Error(`G6 live proof (${provider}) turn 2: expected stopReason end_turn`);

      record.passed = true;
    } catch (error) {
      record.failure = error instanceof Error ? error.message : 'unknown failure';
      throw error;
    } finally {
      record.endedAt = new Date().toISOString();
    }
  }, 180_000);
});
