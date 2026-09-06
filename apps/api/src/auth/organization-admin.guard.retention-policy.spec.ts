import { ExecutionContext } from '@nestjs/common';
import { OrganizationAdminGuard } from './organization-admin.guard';

describe('retention-policy organization authorization', () => {
  it('accepts only an admin membership in the requested organization', async () => {
    const prisma = { organizationMember: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) } };
    const trail = { record: jest.fn() };
    const guard = new OrganizationAdminGuard(prisma as never, trail as never);
    await expect(guard.canActivate(context(sessionPrincipal))).resolves.toBe(true);
  });

  it('rejects API tokens before querying membership', async () => {
    const prisma = { organizationMember: { findUnique: jest.fn() } };
    const trail = { record: jest.fn().mockResolvedValue(undefined) };
    const guard = new OrganizationAdminGuard(prisma as never, trail as never);
    await expect(guard.canActivate(context({ kind: 'token', tokenId: 'tok_1', projectId: 'prj_1', role: 'admin' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });
});

const sessionPrincipal = {
  kind: 'session',
  userId: 'usr_1',
  organizationId: 'org_1',
  rateClass: 'session',
};

function context(principal: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principal, params: { id: 'org_1' } }),
    }),
  } as never;
}
