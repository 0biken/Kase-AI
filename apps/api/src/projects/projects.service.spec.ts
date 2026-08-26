import { Test } from '@nestjs/testing';
import {
  ProjectsService,
  isAttestationStale,
  slugify,
  ATTESTATION_MAX_AGE_MS,
} from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';

describe('isAttestationStale — 17-security §3 (12 months)', () => {
  const now = new Date('2026-08-26T00:00:00Z');

  it('is fresh the day it is made', () => {
    expect(isAttestationStale(now, now)).toBe(false);
  });

  it('is fresh at 11 months', () => {
    const d = new Date(now.getTime() - 330 * 24 * 60 * 60 * 1000);
    expect(isAttestationStale(d, now)).toBe(false);
  });

  it('is stale just past 12 months', () => {
    const d = new Date(now.getTime() - ATTESTATION_MAX_AGE_MS - 1000);
    expect(isAttestationStale(d, now)).toBe(true);
  });

  it('is not stale exactly at the boundary', () => {
    // Boundary belongs to "still valid" — an attestation does not expire
    // mid-request on the anniversary.
    const d = new Date(now.getTime() - ATTESTATION_MAX_AGE_MS);
    expect(isAttestationStale(d, now)).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Acme Web', 'acme-web'],
    ['  Acme   Web  ', 'acme-web'],
    ['Acme/Web (v2)', 'acme-web-v2'],
    ['ACME', 'acme'],
    ['a--b', 'a-b'],
  ])('%s -> %s', (input, expected) => expect(slugify(input)).toBe(expected));

  it('returns empty for a name with nothing sluggable', () => {
    // The service turns this into a 422 asking for an explicit slug rather
    // than inventing one.
    expect(slugify('!!!')).toBe('');
  });
});

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock };
    scopePolicy: { findFirst: jest.Mock };
    target: { findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      scopePolicy: { findFirst: jest.fn() },
      target: { findFirst: jest.fn(), update: jest.fn() },
    };

    const mod = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditTrailService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = mod.get(ProjectsService);
  });

  const actor = { type: 'system' as const, organizationId: 'org_1' };

  describe('create — attestation and destructive rules', () => {
    it('refuses when the principal has no organization', async () => {
      await expect(
        service.create({ name: 'X', scopePolicy: anyPolicy() } as never, { type: 'system' }),
      ).rejects.toBeInstanceOf(ProblemException);
    });

    it('refuses a slug that already exists', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'prj_existing' });
      await expect(
        service.create({ name: 'Acme Web', scopePolicy: anyPolicy() } as never, actor),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses destructiveAllowed against a wildcard allowlist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      // 17 §6 requires recording "for which target"; a wildcard makes that
      // unanswerable, so the unbounded case is refused outright.
      await expect(
        service.create(
          {
            name: 'Acme',
            scopePolicy: {
              ...anyPolicy(),
              destructiveAllowed: true,
              allowedHosts: ['*.acme.com'],
            },
          } as never,
          actor,
        ),
      ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    });

    it('allows destructiveAllowed against exact hosts', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      // Should get past the destructive check and fail later at the DB layer,
      // which is absent in this unit test — proving the guard did not fire.
      await expect(
        service.create(
          {
            name: 'Acme',
            scopePolicy: {
              ...anyPolicy(),
              destructiveAllowed: true,
              allowedHosts: ['staging.acme.com'],
            },
          } as never,
          actor,
        ),
      ).rejects.not.toMatchObject({ code: 'SCOPE_VIOLATION' });
    });
  });

  describe('updateTarget — production re-attestation', () => {
    it('blocks a production change when the attestation is stale', async () => {
      prisma.target.findFirst.mockResolvedValue({
        id: 'tgt_1',
        projectId: 'prj_1',
        environment: 'production',
      });
      prisma.scopePolicy.findFirst.mockResolvedValue({
        authorizationAttestedBy: 'alex@acme.com',
        authorizationAttestedAt: new Date(Date.now() - ATTESTATION_MAX_AGE_MS - 10_000),
      });

      await expect(
        service.updateTarget('prj_1', 'tgt_1', { name: 'renamed' }, actor),
      ).rejects.toMatchObject({ code: 'ATTESTATION_STALE' });
      expect(prisma.target.update).not.toHaveBeenCalled();
    });

    it('allows a production change when the attestation is fresh', async () => {
      prisma.target.findFirst.mockResolvedValue({
        id: 'tgt_1',
        projectId: 'prj_1',
        environment: 'production',
      });
      prisma.scopePolicy.findFirst.mockResolvedValue({
        authorizationAttestedBy: 'alex@acme.com',
        authorizationAttestedAt: new Date(),
      });
      prisma.target.update.mockResolvedValue({ id: 'tgt_1', name: 'renamed' });

      await service.updateTarget('prj_1', 'tgt_1', { name: 'renamed' }, actor);
      expect(prisma.target.update).toHaveBeenCalled();
    });

    it('blocks promoting a staging target to production without attestation', async () => {
      // The rule keys on the change touching production either way round.
      prisma.target.findFirst.mockResolvedValue({
        id: 'tgt_1',
        projectId: 'prj_1',
        environment: 'staging',
      });
      prisma.scopePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTarget('prj_1', 'tgt_1', { environment: 'production' }, actor),
      ).rejects.toMatchObject({ code: 'ATTESTATION_REQUIRED' });
    });

    it('does not require re-attestation for a staging-only change', async () => {
      prisma.target.findFirst.mockResolvedValue({
        id: 'tgt_1',
        projectId: 'prj_1',
        environment: 'staging',
      });
      prisma.target.update.mockResolvedValue({ id: 'tgt_1' });

      await service.updateTarget('prj_1', 'tgt_1', { name: 'renamed' }, actor);
      expect(prisma.scopePolicy.findFirst).not.toHaveBeenCalled();
      expect(prisma.target.update).toHaveBeenCalled();
    });

    it('404s a target belonging to another project', async () => {
      // findFirst is scoped by projectId, so a cross-project id returns null.
      prisma.target.findFirst.mockResolvedValue(null);
      await expect(
        service.updateTarget('prj_1', 'tgt_other', { name: 'x' }, actor),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

function anyPolicy() {
  return {
    allowedHosts: ['staging.acme.com'],
    maxRequestsPerSecond: 10,
    maxRequestsPerAudit: 5000,
    authorizationAttestedBy: 'alex@acme.com',
  };
}
