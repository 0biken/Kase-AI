import { Test } from '@nestjs/testing';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';

describe('TokensService', () => {
  let service: TokensService;
  let prisma: {
    apiToken: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let trail: { record: jest.Mock };

  const actor = { type: 'user' as const, id: 'usr_1', organizationId: 'org_1' };

  beforeEach(async () => {
    prisma = {
      apiToken: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    trail = { record: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditTrailService, useValue: trail },
      ],
    }).compile();

    service = mod.get(TokensService);
  });

  describe('create', () => {
    it('returns the plaintext exactly once, alongside the stored view', async () => {
      prisma.apiToken.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, lastUsedAt: null, revokedAt: null }),
      );

      const result = await service.create('prj_1', { name: 'ci', role: 'operator' }, actor);

      expect(result.plaintext).toMatch(/^kase_/);
      expect(result).not.toHaveProperty('tokenHash');
    });

    it('never persists the plaintext — only the hash and a display prefix', async () => {
      let stored: Record<string, unknown> | undefined;
      prisma.apiToken.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        stored = data;
        return Promise.resolve({ ...data, lastUsedAt: null, revokedAt: null });
      });

      const result = await service.create('prj_1', { name: 'ci', role: 'operator' }, actor);

      expect(stored!.tokenHash).not.toBe(result.plaintext);
      expect(Object.values(stored!)).not.toContain(result.plaintext);
    });

    it('records an audit-trail event without the secret', async () => {
      prisma.apiToken.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, lastUsedAt: null, revokedAt: null }),
      );

      const result = await service.create('prj_1', { name: 'ci', role: 'operator' }, actor);

      const call = trail.record.mock.calls[0][0];
      expect(call.action).toBe('token.create');
      expect(JSON.stringify(call)).not.toContain(result.plaintext);
    });
  });

  describe('list', () => {
    it('never includes tokenHash in the returned view', async () => {
      prisma.apiToken.findMany.mockResolvedValue([
        {
          id: 'tok_1',
          name: 'ci',
          tokenHash: 'deadbeef',
          displayPrefix: 'kase_ab',
          role: 'viewer',
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        },
      ]);

      const result = await service.list('prj_1');

      expect(result[0]).not.toHaveProperty('tokenHash');
      expect(result[0].displayPrefix).toBe('kase_ab');
    });
  });

  describe('revoke', () => {
    it('sets revokedAt rather than deleting the row', async () => {
      prisma.apiToken.findFirst.mockResolvedValue({ id: 'tok_1', revokedAt: null, name: 'ci' });

      await service.revoke('prj_1', 'tok_1', actor);

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: 'tok_1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is idempotent on an already-revoked token', async () => {
      prisma.apiToken.findFirst.mockResolvedValue({
        id: 'tok_1',
        revokedAt: new Date('2020-01-01'),
      });

      await service.revoke('prj_1', 'tok_1', actor);

      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a token that does not belong to this project', async () => {
      prisma.apiToken.findFirst.mockResolvedValue(null);

      await expect(service.revoke('prj_1', 'tok_x', actor)).rejects.toBeInstanceOf(
        ProblemException,
      );
    });
  });
});
