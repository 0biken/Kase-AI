import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectScopeGuard } from './project-scope.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { Principal } from './principal';
import { newId } from '../common/ids';

function ctxWithReq(principal: Principal | undefined, params: Record<string, string> = {}) {
  const req: Record<string, unknown> = { principal, params, originalUrl: '/test', method: 'GET' };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('ProjectScopeGuard', () => {
  let prisma: { projectMember: { findUnique: jest.Mock } };
  let trail: { record: jest.Mock };
  let reflector: Reflector;
  let guard: ProjectScopeGuard;

  const projectA = newId('project');
  const projectB = newId('project');
  const userId = newId('user');

  beforeEach(() => {
    prisma = { projectMember: { findUnique: jest.fn() } };
    trail = { record: jest.fn().mockResolvedValue(undefined) };
    reflector = new Reflector();
    guard = new ProjectScopeGuard(
      reflector,
      prisma as unknown as PrismaService,
      trail as unknown as AuditTrailService,
    );
  });

  // ------------------------------------------------- deny-by-default (core property)

  it('denies a route with no @ProjectScope/@OrgScope decorator, rather than passing through', async () => {
    reflector.getAllAndOverride = jest.fn().mockImplementation((key: string) => {
      if (key === 'kase:isPublic') return undefined;
      if (key === 'kase:scope') return undefined; // nothing registered
      return undefined;
    });
    const { ctx } = ctxWithReq(
      { kind: 'token', tokenId: 't1', projectId: projectA, role: 'admin', rateClass: 'token' },
      { id: projectA },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
  });

  it('a @Public() route bypasses scope checking entirely', async () => {
    reflector.getAllAndOverride = jest.fn().mockImplementation((key: string) =>
      key === 'kase:isPublic' ? true : undefined,
    );
    const { ctx } = ctxWithReq(undefined, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ------------------------------------------------------------------- token principal

  function mockScopeMeta(param = 'id') {
    reflector.getAllAndOverride = jest.fn().mockImplementation((key: string) => {
      if (key === 'kase:isPublic') return undefined;
      if (key === 'kase:scope') return { mode: 'project', param };
      return undefined;
    });
  }

  it('accepts a token scoped to the project being accessed', async () => {
    mockScopeMeta();
    const { ctx } = ctxWithReq(
      { kind: 'token', tokenId: 't1', projectId: projectA, role: 'viewer', rateClass: 'token' },
      { id: projectA },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a token scoped to a DIFFERENT project than the one in the path', async () => {
    mockScopeMeta();
    const { ctx } = ctxWithReq(
      { kind: 'token', tokenId: 't1', projectId: projectA, role: 'admin', rateClass: 'token' },
      { id: projectB },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
    expect(trail.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scope.denied', projectId: projectB }),
    );
  });

  // ----------------------------------------------------------------- session principal

  it('accepts a session user with a ProjectMember row, and attaches their role', async () => {
    mockScopeMeta();
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'operator' });
    const { ctx, req } = ctxWithReq(
      { kind: 'session', userId, organizationId: newId('organization'), rateClass: 'session' },
      { id: projectA },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.principal as { role?: string }).role).toBe('operator');
    expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId, projectId: projectA } },
    });
  });

  it('rejects a session user with NO ProjectMember row for this project', async () => {
    mockScopeMeta();
    prisma.projectMember.findUnique.mockResolvedValue(null);
    const { ctx } = ctxWithReq(
      { kind: 'session', userId, organizationId: newId('organization'), rateClass: 'session' },
      { id: projectA },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'scope.denied' }));
  });

  it('rejects a membership row with a corrupted role rather than trusting it', async () => {
    mockScopeMeta();
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'not-a-real-role' });
    const { ctx } = ctxWithReq(
      { kind: 'session', userId, organizationId: newId('organization'), rateClass: 'session' },
      { id: projectA },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
  });

  // -------------------------------------------------------------------------- org scope

  it('allows a session principal on an @OrgScope() route', async () => {
    reflector.getAllAndOverride = jest.fn().mockImplementation((key: string) =>
      key === 'kase:scope' ? { mode: 'org' } : undefined,
    );
    const { ctx } = ctxWithReq(
      { kind: 'session', userId, organizationId: newId('organization'), rateClass: 'session' },
      {},
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a TOKEN principal on an @OrgScope() route — a token cannot act at the org level', async () => {
    reflector.getAllAndOverride = jest.fn().mockImplementation((key: string) =>
      key === 'kase:scope' ? { mode: 'org' } : undefined,
    );
    const { ctx } = ctxWithReq(
      { kind: 'token', tokenId: 't1', projectId: projectA, role: 'admin', rateClass: 'token' },
      {},
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
  });

  // --------------------------------------------------------------------- malformed input

  it('rejects a malformed project id in the path rather than querying with it', async () => {
    mockScopeMeta();
    const { ctx } = ctxWithReq(
      { kind: 'token', tokenId: 't1', projectId: projectA, role: 'admin', rateClass: 'token' },
      { id: 'not-a-valid-id' },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.projectMember.findUnique).not.toHaveBeenCalled();
  });
});
