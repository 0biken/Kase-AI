import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';

@Injectable()
export class FindingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, auditId: string, filters: { severity?: string; category?: string; gateEligible?: string }) {
    await this.assertAudit(projectId, auditId);
    return this.prisma.finding.findMany({
      where: {
        auditId,
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.gateEligible === undefined ? {} : { gateEligible: filters.gateEligible === 'true' }),
      },
      include: { sourceLocations: true, findingEvidence: true },
      orderBy: { id: 'asc' },
    });
  }

  async detail(projectId: string, auditId: string, findingId: string) {
    await this.assertAudit(projectId, auditId);
    const finding = await this.prisma.finding.findFirst({
      where: { id: findingId, auditId },
      include: { identity: true, sourceLocations: true, findingEvidence: { include: { evidence: true } } },
    });
    if (!finding) throw new ProblemException('NOT_FOUND', 'Finding does not belong to this audit');
    return finding;
  }

  private async assertAudit(projectId: string, auditId: string): Promise<void> {
    const count = await this.prisma.audit.count({ where: { id: auditId, projectId } });
    if (count !== 1) throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
  }
}
