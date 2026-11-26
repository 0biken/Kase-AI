import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { AIProvider } from './ai-provider.interface';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';

type SupportedProvider = 'anthropic' | 'openai' | 'gemini';
const PLATFORM_KEY_ENV: Record<SupportedProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
const BASE_URL_ENV: Record<SupportedProvider, string> = { anthropic: 'KASE_ANTHROPIC_BASE_URL', openai: 'KASE_OPENAI_BASE_URL', gemini: 'KASE_GEMINI_BASE_URL' };
const isSupported = (p: string): p is SupportedProvider => p === 'anthropic' || p === 'openai' || p === 'gemini';

@Injectable()
export class ProviderResolver {
  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretsService) {}
  async forAudit(auditId: string): Promise<AIProvider> {
    const snapshot = await this.prisma.auditAiSnapshot.findUniqueOrThrow({ where: { auditId }, include: { audit: true } });
    const provider = snapshot.provider;
    if (!isSupported(provider)) throw new Error('Unsupported provider');
    let apiKey: string;
    if (snapshot.credentialMode === 'project_secret') {
      if (!snapshot.credentialSecretId || !snapshot.credentialSecretVersion) throw new Error('Frozen credential missing');
      const secret = await this.prisma.secret.findFirst({ where: { id: snapshot.credentialSecretId, projectId: snapshot.audit.projectId, kind: provider + '_api_key', revokedAt: null } });
      if (!secret) throw new Error('Provider credential revoked or invalid');
      apiKey = await this.secrets.resolveForWorker(snapshot.audit.projectId, secret.id, snapshot.credentialSecretVersion);
    } else if (snapshot.credentialMode === 'platform' && (process.env.KASE_PLATFORM_AI_PROVIDERS ?? '').split(',').includes(provider)) {
      const value = process.env[PLATFORM_KEY_ENV[provider]];
      if (!value) throw new Error('Platform provider credential unavailable');
      apiKey = value;
    } else throw new Error('Unsupported credential mode');
    const baseURL = process.env[BASE_URL_ENV[provider]] ?? process.env.AGENT_ROUTER_URL;
    if (!baseURL) throw new Error('Agent Router endpoint must be configured explicitly');
    const url = new URL(baseURL);
    const hosts = (process.env.KASE_AGENT_ROUTER_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !hosts.includes(url.hostname.toLowerCase())) throw new Error('Agent Router endpoint is not allowed');
    const proxy = process.env.KASE_AGENT_EGRESS_PROXY;
    if (process.env.NODE_ENV === 'production' && !proxy) throw new Error('Agent egress proxy is required');
    if (provider === 'gemini') {
      // @google/genai uses Node's built-in fetch, which has no per-client agent. Egress must go
      // through Node's env-proxy support, configured at process start; refuse to run unproxied.
      if (proxy && (process.env.NODE_USE_ENV_PROXY !== '1' ||
          (url.protocol === 'https:' ? process.env.HTTPS_PROXY : process.env.HTTP_PROXY) !== proxy))
        throw new Error('Gemini egress requires NODE_USE_ENV_PROXY=1 with HTTP(S)_PROXY set to the agent egress proxy');
      return new GeminiAdapter(new GoogleGenAI({ apiKey, httpOptions: { baseUrl: baseURL, timeout: 60000, retryOptions: { attempts: 1 } } }));
    }
    const options = { apiKey, baseURL, maxRetries: 0, timeout: 60000, ...(proxy ? { httpAgent: new HttpsProxyAgent(proxy) } : {}) };
    return provider === 'openai' ? new OpenAIAdapter(new OpenAI(options)) : new AnthropicAdapter(new Anthropic(options));
  }
}
