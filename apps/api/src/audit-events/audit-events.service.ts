import { Injectable, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';

export interface PersistedAuditEvent {
  id: string;
  auditId: string;
  sequence: number;
  type: string;
  data: unknown;
  createdAt: Date;
}

@Injectable()
export class AuditEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(auditId: string, type: string, data: unknown): Promise<PersistedAuditEvent> {
    return this.prisma.$transaction(async (tx: any) => {
      if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', auditId);
      }
      const last = await tx.auditEvent.findFirst({
        where: { auditId }, orderBy: { sequence: 'desc' }, select: { sequence: true },
      });
      return tx.auditEvent.create({
        data: {
          id: newId('auditEvent'), auditId, sequence: (last?.sequence ?? 0) + 1,
          type, data: data as never,
        },
      });
    });
  }

  async listAfter(auditId: string, afterSequence = 0, take = 100): Promise<PersistedAuditEvent[]> {
    return (this.prisma.auditEvent as any).findMany({
      where: { auditId, sequence: { gt: Math.max(0, afterSequence) } },
      orderBy: { sequence: 'asc' }, take: Math.min(Math.max(take, 1), 500),
    });
  }

  /** Polling is intentional: persisted rows remain the source of truth across API restarts. */
  stream(auditId: string, afterSequence = 0, pollMs = 1_000): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cursor = Math.max(0, afterSequence);
      let stopped = false;
      let polling = false;
      const poll = async () => {
        if (stopped || polling) return;
        polling = true;
        try {
          const events = await this.listAfter(auditId, cursor);
          for (const event of events) {
            cursor = event.sequence;
            subscriber.next({
              id: String(event.sequence),
              type: event.type,
              data: toMessageData(event.data),
            });
          }
        } catch (error) {
          subscriber.error(error);
        } finally {
          polling = false;
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), pollMs);
      timer.unref?.();
      return () => { stopped = true; clearInterval(timer); };
    });
  }

  streamForProject(projectId: string, auditId: string, afterSequence = 0, pollMs = 1_000): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let inner: { unsubscribe(): void } | undefined;
      void this.prisma.audit.findFirst({ where: { id: auditId, projectId }, select: { id: true } })
        .then((audit) => {
          if (!audit) throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
          inner = this.stream(auditId, afterSequence, pollMs).subscribe(subscriber);
        })
        .catch((error) => subscriber.error(error));
      return () => inner?.unsubscribe();
    });
  }
}

function toMessageData(value: unknown): string | object {
  if (value !== null && typeof value === 'object') return value;
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}
