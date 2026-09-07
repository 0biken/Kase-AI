import { InventoryQueryService } from './inventory-query.service';

describe('InventoryQueryService', () => {
  it('enforces project isolation and reports pending inventories as 409', async () => {
    const prisma: any = {
      audit: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'aud_1' }) },
      endpointInventory: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new InventoryQueryService(prisma);
    await expect(service.get('prj_other', 'aud_1', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.get('prj_1', 'aud_1', {})).rejects.toMatchObject({ code: 'INVENTORY_NOT_READY' });
  });

  it('returns stable pagination and applies normalized filters', async () => {
    const prisma: any = {
      audit: { findFirst: jest.fn().mockResolvedValue({ id: 'aud_1' }) },
      endpointInventory: { findUnique: jest.fn().mockResolvedValue({
        id: 'einv_1', status: 'ready', previousInventoryId: null, generatedAt: new Date(),
        endpointCount: 2, addedCount: 2, removedCount: 0, changedCount: 0, drift: [],
      }) },
      endpoint: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'ep_1' }, { id: 'ep_2' }]) },
    };
    const service = new InventoryQueryService(prisma);
    const result = await service.get('prj_1', 'aud_1', { method: 'get', statusClass: '2xx', limit: '1' });
    expect(prisma.endpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ method: 'GET', statusObserved: { hasSome: expect.arrayContaining([200, 299]) } }), take: 2,
    }));
    expect(result.page).toEqual({ nextCursor: 'ep_1', hasMore: true });
  });

  it('anchors cursors to the stable method/path/id ordering', async () => {
    const prisma: any = {
      audit: { findFirst: jest.fn().mockResolvedValue({ id: 'aud_1' }) },
      endpointInventory: { findUnique: jest.fn().mockResolvedValue({
        id: 'einv_1', status: 'ready', previousInventoryId: null, generatedAt: new Date(),
        endpointCount: 1, addedCount: 0, removedCount: 0, changedCount: 0, drift: [],
      }) },
      endpoint: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ep_1', method: 'GET', pathTemplate: '/a' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    await new InventoryQueryService(prisma).get('prj_1', 'aud_1', { cursor: 'ep_1' });
    expect(prisma.endpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: [{ OR: expect.arrayContaining([
        { method: { gt: 'GET' } },
        { method: 'GET', pathTemplate: '/a', id: { gt: 'ep_1' } },
      ]) }] }),
    }));
  });
});
