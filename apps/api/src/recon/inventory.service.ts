import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventsService } from '../audit-events/audit-events.service';
import { deterministicId } from '../findings/finding-persistence.service';
import { endpointKey, normalizeEndpoint } from './endpoint-normalizer';
import type { VerifiedEndpointCandidate } from './recon.types';

interface EndpointSnapshot {
  id: string; inventoryId: string; method: string; pathTemplate: string; parameters: unknown;
  rawExamples: string[]; discoveredBy: string[]; statusObserved: number[]; contentType: string | null;
  requiresAuth: boolean | null; technologies: string[]; title: string | null; server: string | null;
  firstSeenAuditId: string; lastSeenAuditId: string;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly events: AuditEventsService) {}

  async merge(auditId: string, projectId: string, candidates: readonly VerifiedEndpointCandidate[], signal: AbortSignal) {
    const audit = await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, select: { id: true, targetId: true } });
    if (!audit?.targetId) throw new Error('Recon inventory requires an audit target');
    const previous = await this.prisma.endpointInventory.findFirst({
      where: { projectId, targetId: audit.targetId, status: 'ready', auditId: { not: auditId } },
      orderBy: { generatedAt: 'desc' }, include: { endpoints: true },
    });
    const inventoryId = deterministicId('einv', auditId);
    const previousByKey = new Map((previous?.endpoints ?? []).map((endpoint) => [endpointKey(endpoint.method, endpoint.pathTemplate), endpoint]));
    const merged = mergeCandidates(candidates);
    if (signal.aborted) throw abortError();
    await this.prisma.$transaction(async (tx: any) => {
      throwIfAborted(signal);
      await tx.endpointInventory.upsert({
        where: { auditId },
        create: { id: inventoryId, auditId, projectId, targetId: audit.targetId, previousInventoryId: previous?.id ?? null },
        update: { previousInventoryId: previous?.id ?? null, status: 'building', generatedAt: null },
      });
      await tx.endpoint.deleteMany({ where: { inventoryId } });
      for (const candidate of merged) {
        throwIfAborted(signal);
        const key = endpointKey(candidate.method, candidate.pathTemplate);
        const prior = previousByKey.get(key);
        await tx.endpoint.create({ data: {
          ...candidate,
          id: deterministicId('ep', `${inventoryId}:${key}`), inventoryId,
          firstSeenAuditId: prior?.firstSeenAuditId ?? auditId, lastSeenAuditId: auditId,
        } });
      }
      throwIfAborted(signal);
      await tx.endpointInventory.update({ where: { id: inventoryId }, data: { endpointCount: merged.length } });
    });
    await this.events.append(auditId, 'inventory.merged', { inventoryId, endpointCount: merged.length });
    return { inventoryId, endpointCount: merged.length };
  }

  async computeDrift(auditId: string, projectId: string, signal: AbortSignal) {
    const inventory = await this.prisma.endpointInventory.findFirst({
      where: { auditId, projectId }, include: { endpoints: true, previousInventory: { include: { endpoints: true } } },
    });
    if (!inventory) throw new Error('Inventory must be merged before drift');
    const current = new Map(inventory.endpoints.map((endpoint) => [endpointKey(endpoint.method, endpoint.pathTemplate), endpoint]));
    const previous = new Map((inventory.previousInventory?.endpoints ?? []).map((endpoint) => [endpointKey(endpoint.method, endpoint.pathTemplate), endpoint]));
    const drift: Array<{ key: string; kind: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }> = [];
    for (const [key, endpoint] of current) {
      const prior = previous.get(key);
      if (!prior) drift.push({ key, kind: 'added', after: safeMetadata(endpoint) });
      else if (metadataFingerprint(prior) !== metadataFingerprint(endpoint)) drift.push({ key, kind: 'changed', before: safeMetadata(prior), after: safeMetadata(endpoint) });
    }
    for (const [key, endpoint] of previous) if (!current.has(key)) drift.push({ key, kind: 'removed', before: safeMetadata(endpoint) });
    if (signal.aborted) throw abortError();
    await this.prisma.$transaction(async (tx: any) => {
      throwIfAborted(signal);
      await tx.endpointDrift.deleteMany({ where: { inventoryId: inventory.id } });
      for (const item of drift) {
        throwIfAborted(signal);
        await tx.endpointDrift.create({ data: {
          id: deterministicId('edrift', `${inventory.id}:${item.kind}:${item.key}`), inventoryId: inventory.id,
          endpointKey: item.key, kind: item.kind, previousMetadata: item.before, currentMetadata: item.after,
        } });
      }
      throwIfAborted(signal);
      await tx.endpointInventory.update({ where: { id: inventory.id }, data: {
        status: 'ready', generatedAt: new Date(),
        addedCount: drift.filter((item) => item.kind === 'added').length,
        removedCount: drift.filter((item) => item.kind === 'removed').length,
        changedCount: drift.filter((item) => item.kind === 'changed').length,
      } });
    });
    const counts = {
      added: drift.filter((item) => item.kind === 'added').length,
      removed: drift.filter((item) => item.kind === 'removed').length,
      changed: drift.filter((item) => item.kind === 'changed').length,
    };
    await this.events.append(auditId, 'inventory.ready', { inventoryId: inventory.id, ...counts });
    return counts;
  }
}

export function mergeCandidates(candidates: readonly VerifiedEndpointCandidate[]): Omit<EndpointSnapshot, 'id' | 'inventoryId' | 'firstSeenAuditId' | 'lastSeenAuditId'>[] {
  const merged = new Map<string, ReturnType<typeof seedCandidate>>();
  for (const input of candidates) {
    const canonical = normalizeEndpoint(input.url, input.method);
    const key = endpointKey(canonical.method, canonical.pathTemplate);
    const existing = merged.get(key) ?? seedCandidate(canonical, input);
    existing.parameters = unionByName(existing.parameters, canonical.parameters);
    existing.rawExamples = unique(existing.rawExamples.concat(canonical.rawExample)).slice(0, 10);
    existing.discoveredBy = unique(existing.discoveredBy.concat(input.source)).sort();
    if (input.status !== undefined) existing.statusObserved = unique(existing.statusObserved.concat(input.status)).sort((a, b) => a - b);
    existing.technologies = unique(existing.technologies.concat(input.technologies)).sort();
    existing.contentType = input.contentType ?? existing.contentType;
    existing.title = input.title ?? existing.title;
    existing.server = input.server ?? existing.server;
    if (input.status !== undefined && [401, 403].includes(input.status)) existing.requiresAuth = true;
    merged.set(key, existing);
  }
  return [...merged.values()].sort((a, b) => `${a.method} ${a.pathTemplate}`.localeCompare(`${b.method} ${b.pathTemplate}`));
}

function seedCandidate(canonical: ReturnType<typeof normalizeEndpoint>, input: VerifiedEndpointCandidate) {
  return { method: canonical.method, pathTemplate: canonical.pathTemplate, parameters: canonical.parameters,
    rawExamples: [canonical.rawExample], discoveredBy: [input.source],
    statusObserved: input.status === undefined ? [] : [input.status], contentType: input.contentType ?? null,
    requiresAuth: input.status !== undefined && [401, 403].includes(input.status) ? true : null,
    technologies: unique(input.technologies).sort(), title: input.title ?? null, server: input.server ?? null };
}

function safeMetadata(value: any) { return { statuses: value.statusObserved, contentType: value.contentType, requiresAuth: value.requiresAuth, technologies: value.technologies }; }
export function metadataFingerprint(value: Pick<EndpointSnapshot, 'statusObserved' | 'contentType' | 'requiresAuth' | 'technologies'>): string {
  return JSON.stringify({
    statusClasses: unique(value.statusObserved.map((status) => Math.floor(status / 100))).sort(),
    contentType: value.contentType,
    requiresAuth: value.requiresAuth,
    technologies: unique(value.technologies).sort(),
  });
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function unionByName(left: any[], right: any[]): any[] { return [...new Map([...left, ...right].map((item) => [item.name, item])).values()].sort((a, b) => a.name.localeCompare(b.name)); }
function abortError(): Error { const error = new Error('Audit cancellation requested'); error.name = 'AbortError'; return error; }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
