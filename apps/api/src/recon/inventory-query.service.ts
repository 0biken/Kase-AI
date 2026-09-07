import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';

export interface InventoryFilters {
  method?: string; path?: string; source?: string; statusClass?: string; technology?: string; drift?: string;
  cursor?: string; limit?: string;
}

@Injectable()
export class InventoryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(projectId: string, auditId: string, filters: InventoryFilters) {
    const audit = await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, select: { id: true } });
    if (!audit) throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
    const inventory = await this.prisma.endpointInventory.findUnique({ where: { auditId }, include: { drift: true } });
    if (!inventory || inventory.status !== 'ready') throw new ProblemException('INVENTORY_NOT_READY', 'Endpoint inventory is not ready');
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const driftKeys = filters.drift ? inventory.drift.filter((item) => item.kind === filters.drift).map((item) => item.endpointKey) : null;
    const statuses = statusClass(filters.statusClass);
    const cursorEndpoint = filters.cursor ? await this.prisma.endpoint.findFirst({
      where: { id: filters.cursor, inventoryId: inventory.id },
      select: { id: true, method: true, pathTemplate: true },
    }) : null;
    if (filters.cursor && !cursorEndpoint) throw new ProblemException('VALIDATION_FAILED', 'Invalid inventory cursor');
    const endpoints = await this.prisma.endpoint.findMany({
      where: {
        inventoryId: inventory.id,
        ...(filters.method ? { method: filters.method.toUpperCase() } : {}),
        ...(filters.path ? { pathTemplate: { contains: filters.path } } : {}),
        ...(filters.source ? { discoveredBy: { has: filters.source } } : {}),
        ...(filters.technology ? { technologies: { has: filters.technology } } : {}),
        ...(statuses ? { statusObserved: { hasSome: statuses } } : {}),
        ...(driftKeys ? { OR: driftKeys.map((key) => {
          const separator = key.indexOf(' ');
          return { method: key.slice(0, separator), pathTemplate: key.slice(separator + 1) };
        }) } : {}),
        ...(cursorEndpoint ? { AND: [{ OR: [
          { method: { gt: cursorEndpoint.method } },
          { method: cursorEndpoint.method, pathTemplate: { gt: cursorEndpoint.pathTemplate } },
          { method: cursorEndpoint.method, pathTemplate: cursorEndpoint.pathTemplate, id: { gt: cursorEndpoint.id } },
        ] }] } : {}),
      },
      orderBy: [{ method: 'asc' }, { pathTemplate: 'asc' }, { id: 'asc' }], take: limit + 1,
    });
    const hasMore = endpoints.length > limit;
    const page = endpoints.slice(0, limit);
    return {
      id: inventory.id, auditId, previousInventoryId: inventory.previousInventoryId, generatedAt: inventory.generatedAt,
      summary: { endpointCount: inventory.endpointCount, added: inventory.addedCount, removed: inventory.removedCount, changed: inventory.changedCount },
      endpoints: page, drift: inventory.drift,
      page: { nextCursor: hasMore ? page.at(-1)?.id ?? null : null, hasMore },
    };
  }
}

function statusClass(value?: string): number[] | null {
  if (!value) return null;
  if (!/^[1-5]xx$/u.test(value)) throw new ProblemException('VALIDATION_FAILED', 'statusClass must be 1xx through 5xx');
  const start = Number(value[0]) * 100;
  return Array.from({ length: 100 }, (_, index) => start + index);
}
