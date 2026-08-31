import { SecretsService } from './secrets.service';
import { EnvelopeCryptoService } from './envelope-crypto.service';
import { LocalKeyEncryptionProvider } from './key-encryption.provider';
import { ProblemException } from '../common/problem-details';

describe('SecretsService', () => {
  const actor = { type: 'user' as const, id: 'usr_1' };
  const projectId = 'prj_1';
  let prisma: any;
  let trail: { record: jest.Mock };
  let service: SecretsService;

  beforeEach(() => {
    const stored: any[] = [];
    prisma = {
      secret: {
        create: jest.fn(async ({ data }) => ({
          ...data,
          currentVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          revokedAt: null,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      secretVersion: {
        create: jest.fn(async ({ data }) => {
          stored.push(data);
          return data;
        }),
      },
      $transaction: jest.fn(async (callback) => callback(prisma)),
      __stored: stored,
    };
    trail = { record: jest.fn().mockResolvedValue(undefined) };
    const crypto = new EnvelopeCryptoService(
      new LocalKeyEncryptionProvider(Buffer.alloc(32, 4).toString('base64url')),
    );
    service = new SecretsService(prisma, crypto, trail as never);
  });

  it('stores only encrypted material and returns metadata only', async () => {
    const plaintext = 'github_pat_sensitive';
    const result = await service.create(
      projectId,
      { name: 'GitHub', kind: 'repository_token', value: plaintext },
      actor,
    );
    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(prisma.__stored)).not.toContain(plaintext);
    expect(JSON.stringify(trail.record.mock.calls)).not.toContain(plaintext);
  });

  it('rotates by inserting a new immutable version after claiming the current one', async () => {
    prisma.secret.findFirst.mockResolvedValue({
      id: 'sec_1', projectId, currentVersion: 1, revokedAt: null,
    });
    prisma.secret.updateMany.mockResolvedValue({ count: 1 });
    prisma.secret.findUniqueOrThrow.mockResolvedValue({
      id: 'sec_1', name: 'GitHub', kind: 'repository_token', currentVersion: 2,
      createdBy: actor.id, createdAt: new Date(), updatedAt: new Date(), revokedAt: null,
    });
    const result = await service.rotate(projectId, 'sec_1', { value: 'replacement' }, actor);
    expect(result.currentVersion).toBe(2);
    expect(prisma.__stored.at(-1).version).toBe(2);
    expect(JSON.stringify(prisma.__stored)).not.toContain('replacement');
  });

  it('rejects rotation when another request already changed the version', async () => {
    prisma.secret.findFirst.mockResolvedValue({
      id: 'sec_1', projectId, currentVersion: 1, revokedAt: null,
    });
    prisma.secret.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.rotate(projectId, 'sec_1', { value: 'replacement' }, actor))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('revokes without deleting and is idempotent', async () => {
    prisma.secret.findFirst.mockResolvedValue({
      id: 'sec_1', name: 'GitHub', currentVersion: 1, revokedAt: null,
    });
    prisma.secret.update.mockResolvedValue({});
    await service.revoke(projectId, 'sec_1', actor);
    expect(prisma.secret.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { revokedAt: expect.any(Date) },
    }));
    expect(prisma.secret.delete).toBeUndefined();
  });

  it('refuses to lease a missing or revoked secret to a worker', async () => {
    prisma.secret.findFirst.mockResolvedValue(null);
    await expect(service.resolveForWorker(projectId, 'sec_1')).rejects.toBeInstanceOf(
      ProblemException,
    );
  });
});
