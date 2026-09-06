import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';

/**
 * Organization policy mutation is intentionally unavailable to API tokens.
 * Project admin and organization admin are separate grants; neither implies
 * the other.
 */
@Injectable()
export class OrganizationAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    const rawOrganizationId = request.params.id;
    const organizationId = Array.isArray(rawOrganizationId) ? rawOrganizationId[0] : rawOrganizationId;

    if (
      principal?.kind !== 'session' ||
      principal.organizationId !== organizationId
    ) {
      await this.denied(request, organizationId, 'organization scope mismatch or API token');
      throw new ProblemException(
        'FORBIDDEN',
        'Organization policy changes require a session in that organization',
      );
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: principal.userId,
          organizationId,
        },
      },
      select: { role: true },
    });

    if (membership?.role !== 'admin') {
      await this.denied(request, organizationId, 'organization admin membership required');
      throw new ProblemException('FORBIDDEN', 'Organization administrator role is required');
    }
    return true;
  }

  private async denied(request: Request, organizationId: string, reason: string): Promise<void> {
    await this.trail.record({
      actorType: request.principal?.kind === 'token' ? 'token' : 'user',
      actorId:
        request.principal?.kind === 'token'
          ? request.principal.tokenId
          : (request.principal?.userId ?? null),
      action: 'evidence_policy.authorization_denied',
      resourceType: 'Organization',
      resourceId: organizationId,
      metadata: { reason },
      outcome: 'denied',
    });
  }
}
