import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReconBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(auditId: string, requested: number): Promise<number> {
    if (!Number.isInteger(requested) || requested <= 0) return 0;
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT "auditId" FROM "ReconRequestBudget" WHERE "auditId" = $1 FOR UPDATE', auditId);
      const budget = await tx.reconRequestBudget.findUniqueOrThrow({ where: { auditId } });
      const available = Math.max(0, budget.reconLimit - budget.reserved - budget.consumed);
      const granted = Math.min(requested, available);
      if (granted > 0) await tx.reconRequestBudget.update({ where: { auditId }, data: { reserved: { increment: granted } } });
      return granted;
    });
  }

  async settle(auditId: string, reserved: number, consumed: number): Promise<void> {
    if (consumed < 0 || consumed > reserved) throw new Error('Consumed recon requests must fit the reservation');
    await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT "auditId" FROM "ReconRequestBudget" WHERE "auditId" = $1 FOR UPDATE', auditId);
      const budget = await tx.reconRequestBudget.findUniqueOrThrow({ where: { auditId } });
      if (budget.reserved < reserved || budget.consumed + consumed > budget.reconLimit) throw new Error('Recon request budget invariant violated');
      await tx.reconRequestBudget.update({ where: { auditId }, data: {
        reserved: { decrement: reserved }, consumed: { increment: consumed },
      } });
    });
  }
}
