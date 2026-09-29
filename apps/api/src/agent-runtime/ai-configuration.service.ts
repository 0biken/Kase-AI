import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { MethodologyGuard } from './methodology.guard';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import type { Actor } from '../projects/projects.service';

const positive = z.number().int().positive();
export const AiConfigurationSchema = z.object({
  provider: z.enum(['anthropic', 'openai']), modelId: z.string().min(1).max(200),
  catalogRevision: positive, credentialMode: z.enum(['project_secret', 'platform']),
  credentialSecretId: z.string().min(1).nullable().optional(),
  budgetTotalTokens: positive.max(2000000).default(2000000),
  budgetMaxCalls: positive.max(120).default(120),
  budgetMaxContextBytes: positive.max(400000).default(400000),
  budgetMaxOutputTokens: positive.max(16000).default(16000),
  budgetBlackboxTokens: positive.max(900000).default(900000),
  budgetBlackboxCalls: positive.max(54).default(54),
  budgetWhiteboxTokens: positive.max(700000).default(700000),
  budgetWhiteboxCalls: positive.max(42).default(42),
}).strict().superRefine((c, ctx) => {
  if (c.budgetBlackboxTokens + c.budgetWhiteboxTokens > c.budgetTotalTokens ||
      c.budgetBlackboxCalls + c.budgetWhiteboxCalls > c.budgetMaxCalls)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Stage budgets exceed audit budget' });
  if ((c.credentialMode === 'project_secret') !== Boolean(c.credentialSecretId))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Credential reference does not match mode' });
  if (/(^latest$|^sonnet$|^opus$|latest$)/i.test(c.modelId))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An exact catalog model is required' });
});
export type AiConfigurationInput = z.infer<typeof AiConfigurationSchema>;
@Injectable()
export class AiConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly methodology: MethodologyGuard,
    private readonly trail: AuditTrailService) {}
  async validate(projectId: string, input: unknown) {
    const parsed = AiConfigurationSchema.safeParse(input);
    if (!parsed.success) throw new ProblemException('VALIDATION_FAILED', parsed.error.issues.map(i => i.message).join('; '));
    const config = parsed.data;
    const model = await this.prisma.modelCatalogEntry.findUnique({
      where: { provider_modelId_catalogRevision: { provider: config.provider, modelId: config.modelId, catalogRevision: config.catalogRevision } },
    });
    if (!model || model.status !== 'available' || model.retiredAt ||
        !['streaming', 'tool_use'].every(c => model.capabilities.includes(c)) ||
        !Number.isSafeInteger(model.contextLimit) || model.contextLimit <= config.budgetMaxOutputTokens ||
        !Number.isSafeInteger(model.outputLimit) || model.outputLimit <= 0 ||
        config.budgetMaxOutputTokens > model.outputLimit)
      throw new ProblemException('AI_CONFIGURATION_REQUIRED', 'Selected model is unavailable or incompatible');
    let credentialSecretVersion: number | null = null;
    if (config.credentialMode === 'project_secret') {
      const secret = await this.prisma.secret.findFirst({ where: {
        id: config.credentialSecretId!, projectId, revokedAt: null, kind: config.provider + '_api_key',
      } });
      if (!secret) throw new ProblemException('AI_CONFIGURATION_REQUIRED', 'Selected provider credential is unavailable');
      credentialSecretVersion = secret.currentVersion;
    } else if (!(process.env.KASE_PLATFORM_AI_PROVIDERS ?? '').split(',').includes(config.provider)) {
      throw new ProblemException('AI_CONFIGURATION_REQUIRED', 'Platform credentials are not enabled for this provider');
    }
    return { config, credentialSecretVersion, model };
  }
  async put(projectId: string, input: unknown, actor: Actor) {
    const { config } = await this.validate(projectId, input);
    const data = { ...config, credentialSecretId: config.credentialSecretId ?? null, updatedBy: actor.id ?? actor.type };
    const result = await this.prisma.projectAiConfiguration.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: 'ai_configuration.update', resourceType: 'Project', resourceId: projectId, outcome: 'allowed', metadata: { provider: config.provider, modelId: config.modelId, catalogRevision: config.catalogRevision, credentialMode: config.credentialMode } });
    return result;
  }
  async snapshot(projectId: string) {
    const row = await this.prisma.projectAiConfiguration.findUnique({ where: { projectId } });
    if (!row) throw new ProblemException('AI_CONFIGURATION_REQUIRED', 'Project AI configuration is required');
    const { projectId: ignored, updatedBy, updatedAt, createdAt, ...input } = row;
    const { config, credentialSecretVersion, model } = await this.validate(projectId, input);
    const methodologyDigest = await this.methodology.verifyIntegrity();
    return { ...config, credentialSecretId: config.credentialSecretId ?? null, credentialSecretVersion,
      modelContextLimit: model.contextLimit, modelOutputLimit: model.outputLimit,
      methodologyDigest, promptVersion: this.methodology.getPromptVersion() };
  }
}

