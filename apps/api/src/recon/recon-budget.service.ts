import { Injectable } from '@nestjs/common';
import { deterministicId } from '../findings/finding-persistence.service';
import { PrismaService } from '../prisma/prisma.service';

export type ReconReservationStage = 'katana' | 'httpx' | 'httpx_redirect';

export interface ReconReservationRequest {
  auditId: string;
  auditJobId: string;
  stage: ReconReservationStage;
  requested: number;
  leaseExpiresAt: Date;
}

export interface ReconReservation {
  id: string;
  granted: number;
  stage: ReconReservationStage;
}

/** PostgreSQL is the authority for capacity; lost allocations are charged fail-closed. */
@Injectable()
export class ReconBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(request: ReconReservationRequest): Promise<ReconReservation> {
    if (!Number.isInteger(request.requested) || request.requested <= 0) return { id: '', granted: 0, stage: request.stage };
    return this.prisma.$transaction(async (tx: any) => {
      await lockBudget(tx, request.auditId);
      const now = new Date();
      const existing = await tx.reconRequestReservation.findUnique({
        where: { auditJobId_stage: { auditJobId: request.auditJobId, stage: request.stage } },
      });
      if (existing?.status === 'active' && existing.leaseExpiresAt >= now) {
        return { id: existing.id, granted: existing.reservedCount, stage: request.stage };
      }
      if (existing?.status === 'active') await reclaimLocked(tx, existing, now);
      const budget = await tx.reconRequestBudget.findUniqueOrThrow({ where: { auditId: request.auditId } });
      const granted = Math.min(request.requested, Math.max(0, budget.reconLimit - budget.reserved - budget.consumed));
      if (granted === 0) return { id: existing?.id ?? '', granted, stage: request.stage };
      const id = existing?.id ?? deterministicId('reconReservation', `${request.auditJobId}:${request.stage}`);
      await tx.reconRequestBudget.update({ where: { auditId: request.auditId }, data: { reserved: { increment: granted } } });
      await tx.reconRequestReservation.upsert({
        where: { auditJobId_stage: { auditJobId: request.auditJobId, stage: request.stage } },
        create: { id, auditId: request.auditId, auditJobId: request.auditJobId, stage: request.stage, reservedCount: granted, consumedCount: 0, status: 'active', leaseExpiresAt: request.leaseExpiresAt },
        update: { reservedCount: granted, consumedCount: 0, status: 'active', leaseExpiresAt: request.leaseExpiresAt },
      });
      return { id, granted, stage: request.stage };
    });
  }

  async settle(reservation: ReconReservation, consumed: number): Promise<void> {
    if (!reservation.id || reservation.granted === 0) return;
    if (!Number.isInteger(consumed) || consumed < 0 || consumed > reservation.granted) throw new Error('Consumed recon requests must fit the reservation');
    await this.prisma.$transaction(async (tx: any) => {
      await lockReservation(tx, reservation.id);
      const row = await tx.reconRequestReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      if (row.status !== 'active') return;
      await lockBudget(tx, row.auditId);
      await tx.reconRequestBudget.update({ where: { auditId: row.auditId }, data: { reserved: { decrement: row.reservedCount }, consumed: { increment: consumed } } });
      await tx.reconRequestReservation.update({ where: { id: row.id }, data: { consumedCount: consumed, status: 'settled', leaseExpiresAt: new Date() } });
    });
  }

  async renewForJob(auditJobId: string, leaseExpiresAt: Date): Promise<void> {
    await this.prisma.reconRequestReservation.updateMany({ where: { auditJobId, status: 'active' }, data: { leaseExpiresAt } });
  }

  /** Scheduler calls this before an expired job becomes eligible for another attempt. */
  async reclaimExpired(now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx: any) => {
      const rows = await tx.$queryRawUnsafe(
        'SELECT id, "auditId", "reservedCount" FROM "ReconRequestReservation" WHERE status = $1 AND "leaseExpiresAt" < $2 FOR UPDATE SKIP LOCKED', 'active', now,
      ) as Array<{ id: string; auditId: string; reservedCount: number }>;
      if (rows.length === 0) return 0;
      const byAudit = new Map<string, number>();
      for (const row of rows) byAudit.set(row.auditId, (byAudit.get(row.auditId) ?? 0) + row.reservedCount);
      for (const auditId of [...byAudit.keys()].sort()) await lockBudget(tx, auditId);
      for (const [auditId, count] of byAudit) await tx.reconRequestBudget.update({ where: { auditId }, data: { reserved: { decrement: count }, consumed: { increment: count } } });
      for (const row of rows) await tx.reconRequestReservation.update({
        where: { id: row.id }, data: { status: 'reclaimed', consumedCount: row.reservedCount, leaseExpiresAt: now },
      });
      return rows.length;
    });
  }
}

async function lockBudget(tx: any, auditId: string): Promise<void> {
  await tx.$queryRawUnsafe('SELECT "auditId" FROM "ReconRequestBudget" WHERE "auditId" = $1 FOR UPDATE', auditId);
}
async function lockReservation(tx: any, id: string): Promise<void> {
  await tx.$queryRawUnsafe('SELECT id FROM "ReconRequestReservation" WHERE id = $1 FOR UPDATE', id);
}
async function reclaimLocked(tx: any, row: { id: string; auditId: string; reservedCount: number }, now: Date): Promise<void> {
  await tx.reconRequestBudget.update({ where: { auditId: row.auditId }, data: { reserved: { decrement: row.reservedCount }, consumed: { increment: row.reservedCount } } });
  await tx.reconRequestReservation.update({ where: { id: row.id }, data: { status: 'reclaimed', consumedCount: row.reservedCount, leaseExpiresAt: now } });
}
