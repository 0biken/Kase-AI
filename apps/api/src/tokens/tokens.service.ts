import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { newId } from '../common/ids';
import { generateApiToken } from '../auth/token-secret';
import { Actor } from '../projects/projects.service';
import { CreateApiTokenDto } from './dto/api-token.dto';

/** Never includes `tokenHash` — this is the shape returned by list/create. */
export interface ApiTokenView {
  id: string;
  name: string;
  displayPrefix: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  /**
   * The plaintext is returned exactly once, here. Nothing else in the API —
   * not `list`, not the audit trail, not logs — ever has it again; only
   * `tokenHash` is persisted and only `displayPrefix` is ever shown after
   * this response.
   */
  async create(
    projectId: string,
    dto: CreateApiTokenDto,
    actor: Actor,
  ): Promise<ApiTokenView & { plaintext: string }> {
    const generated = generateApiToken();
    const id = newId('apiToken');

    const record = await this.prisma.apiToken.create({
      data: {
        id,
        projectId,
        name: dto.name,
        tokenHash: generated.tokenHash,
        displayPrefix: generated.displayPrefix,
        role: dto.role,
        createdBy: actor.id ?? 'unknown',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'token.create',
      resourceType: 'ApiToken',
      resourceId: id,
      // name/role/prefix are fine to keep; the plaintext and hash never
      // reach this call at all, so there is nothing here to redact.
      metadata: { name: dto.name, role: dto.role, displayPrefix: generated.displayPrefix },
      outcome: 'allowed',
    });

    return { ...toView(record), plaintext: generated.plaintext };
  }

  async list(projectId: string): Promise<ApiTokenView[]> {
    const records = await this.prisma.apiToken.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toView);
  }

  /** Revocation is a timestamp, not a delete — see the model comment in schema.prisma. */
  async revoke(projectId: string, tokenId: string, actor: Actor): Promise<void> {
    const record = await this.prisma.apiToken.findFirst({
      where: { id: tokenId, projectId },
    });
    if (!record) {
      throw new ProblemException('NOT_FOUND', `No token "${tokenId}" in this project`);
    }
    if (record.revokedAt) return; // already revoked: idempotent, not an error

    await this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'token.revoke',
      resourceType: 'ApiToken',
      resourceId: tokenId,
      metadata: { name: record.name, displayPrefix: record.displayPrefix },
      outcome: 'allowed',
    });
  }
}

function toView(record: {
  id: string;
  name: string;
  displayPrefix: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): ApiTokenView {
  return {
    id: record.id,
    name: record.name,
    displayPrefix: record.displayPrefix,
    role: record.role,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}
