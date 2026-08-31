import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { newId } from '../common/ids';
import type { Actor } from '../projects/projects.service';
import { EnvelopeCryptoService, type EncryptedEnvelope } from './envelope-crypto.service';
import type { CreateSecretDto, RotateSecretDto } from './dto/secret.dto';

export interface SecretView {
  id: string;
  name: string;
  kind: string;
  currentVersion: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class SecretsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeCryptoService,
    private readonly trail: AuditTrailService,
  ) {}

  async create(projectId: string, dto: CreateSecretDto, actor: Actor): Promise<SecretView> {
    const id = newId('secret');
    const versionId = newId('secretVersion');
    const envelope = await this.crypto.encrypt(dto.value, contextFor(id, 1));

    let record: SecretView;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const secret = await tx.secret.create({
          data: {
            id,
            projectId,
            name: dto.name,
            kind: dto.kind,
            createdBy: actor.id ?? 'unknown',
          },
        });
        await tx.secretVersion.create({
          data: versionData(versionId, id, 1, actor, envelope),
        });
        return toView(secret);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ProblemException('CONFLICT', `A secret named "${dto.name}" already exists`);
      }
      throw error;
    }

    await this.recordLifecycle('secret.create', projectId, id, actor, {
      name: dto.name,
      kind: dto.kind,
      version: 1,
    });
    return record;
  }

  async list(projectId: string): Promise<SecretView[]> {
    const rows = await this.prisma.secret.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async rotate(
    projectId: string,
    secretId: string,
    dto: RotateSecretDto,
    actor: Actor,
  ): Promise<SecretView> {
    const current = await this.prisma.secret.findFirst({ where: { id: secretId, projectId } });
    if (!current) throw new ProblemException('NOT_FOUND', `No secret "${secretId}" in this project`);
    if (current.revokedAt) throw new ProblemException('CONFLICT', 'A revoked secret cannot be rotated');

    const nextVersion = current.currentVersion + 1;
    const envelope = await this.crypto.encrypt(dto.value, contextFor(secretId, nextVersion));
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.secret.updateMany({
        where: { id: secretId, projectId, currentVersion: current.currentVersion, revokedAt: null },
        data: { currentVersion: nextVersion },
      });
      if (claimed.count !== 1) {
        throw new ProblemException('CONFLICT', 'The secret changed during rotation; retry the request');
      }
      await tx.secretVersion.create({
        data: versionData(newId('secretVersion'), secretId, nextVersion, actor, envelope),
      });
      return tx.secret.findUniqueOrThrow({ where: { id: secretId } });
    });

    await this.recordLifecycle('secret.rotate', projectId, secretId, actor, { version: nextVersion });
    return toView(updated);
  }

  async revoke(projectId: string, secretId: string, actor: Actor): Promise<void> {
    const existing = await this.prisma.secret.findFirst({ where: { id: secretId, projectId } });
    if (!existing) throw new ProblemException('NOT_FOUND', `No secret "${secretId}" in this project`);
    if (existing.revokedAt) return;
    await this.prisma.secret.update({ where: { id: secretId }, data: { revokedAt: new Date() } });
    await this.recordLifecycle('secret.revoke', projectId, secretId, actor, {
      name: existing.name,
      version: existing.currentVersion,
    });
  }

  /** Internal worker-only lease. It is never exposed by a controller. */
  async resolveForWorker(projectId: string, secretId: string): Promise<string> {
    const secret = await this.prisma.secret.findFirst({
      where: { id: secretId, projectId, revokedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!secret || secret.versions.length !== 1) {
      throw new ProblemException('NOT_FOUND', 'Credential is missing or revoked');
    }
    const version = secret.versions[0];
    return this.crypto.decrypt(version, contextFor(secret.id, version.version));
  }

  async assertUsable(projectId: string, secretId: string): Promise<void> {
    const count = await this.prisma.secret.count({ where: { id: secretId, projectId, revokedAt: null } });
    if (count !== 1) throw new ProblemException('VALIDATION_FAILED', 'Credential is missing or revoked');
  }

  private recordLifecycle(
    action: string,
    projectId: string,
    secretId: string,
    actor: Actor,
    metadata: Record<string, unknown>,
  ) {
    return this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action,
      resourceType: 'Secret',
      resourceId: secretId,
      metadata,
      outcome: 'allowed',
    });
  }
}

function contextFor(secretId: string, version: number): string {
  return `kase:secret:${secretId}:v${version}`;
}

function versionData(
  id: string,
  secretId: string,
  version: number,
  actor: Actor,
  value: EncryptedEnvelope,
) {
  return {
    id,
    secretId,
    version,
    ...value,
    createdBy: actor.id ?? 'unknown',
  };
}

function toView(record: SecretView): SecretView {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    currentVersion: record.currentVersion,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}
