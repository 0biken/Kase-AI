import { resolveSignIn } from './invite';
import { newId } from './ids';

/**
 * ADR-013's central claim, tested hardest: a successful OAuth handshake must
 * not by itself produce an account.
 */
describe('resolveSignIn — invite-only provisioning', () => {
  const orgId = newId('organization');
  const now = new Date('2026-08-27T12:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');
  const past = new Date('2026-01-01T00:00:00Z');

  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    invite: { findFirst: jest.Mock; update: jest.Mock };
    projectMember: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      invite: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      projectMember: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
  });

  const identity = (over: Record<string, unknown> = {}) => ({
    email: 'alex@acme.com',
    emailVerified: true,
    name: 'Alex',
    provider: 'google',
    ...over,
  });

  const run = (over = {}) => resolveSignIn(prisma as never, identity(over), now);

  // ------------------------------------------------------ the core property

  it('denies sign-in and creates NO user when there is no invite', async () => {
    const result = await run();

    expect(result).toEqual({ allowed: false, reason: 'no_invite' });
    // The assertion that matters: OAuth succeeded, and nothing was created.
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('denies an unverified email even when a matching invite exists', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'admin', projectIds: [], expiresAt: future, acceptedAt: null,
    });

    const result = await run({ emailVerified: false });

    // Otherwise anyone able to set an arbitrary address at a provider that
    // does not verify it could claim a colleague's invite.
    expect(result).toEqual({ allowed: false, reason: 'email_unverified' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('denies when the provider released no email at all', async () => {
    const result = await run({ email: null });
    expect(result).toEqual({ allowed: false, reason: 'no_email' });
    expect(prisma.invite.findFirst).not.toHaveBeenCalled();
  });

  it('denies an expired invite', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'admin', projectIds: [], expiresAt: past, acceptedAt: null,
    });

    expect(await run()).toEqual({ allowed: false, reason: 'invite_expired' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('denies an invite that was already accepted', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'admin', projectIds: [], expiresAt: future,
      acceptedAt: new Date('2026-02-01'),
    });

    expect(await run()).toEqual({ allowed: false, reason: 'invite_already_accepted' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------- happy path

  it('creates the user bound to the invite organization', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'operator', projectIds: [], expiresAt: future, acceptedAt: null,
    });

    const result = await run();

    expect(result).toMatchObject({ allowed: true, organizationId: orgId });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'alex@acme.com', organizationId: orgId }),
    });
  });

  it('enrols the user into the invite projects with the invite role', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'approver',
      projectIds: ['prj_a', 'prj_b'], expiresAt: future, acceptedAt: null,
    });

    await run();

    expect(prisma.projectMember.create).toHaveBeenCalledTimes(2);
    expect(prisma.projectMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'prj_a', role: 'approver' }),
    });
  });

  it('marks the invite accepted and links it to the created user', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'viewer', projectIds: [], expiresAt: future, acceptedAt: null,
    });

    const result = await run();

    expect(prisma.invite.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { acceptedAt: now, acceptedUserId: (result as { userId: string }).userId },
    });
  });

  it('does all of it in one transaction', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'viewer', projectIds: ['prj_a'], expiresAt: future, acceptedAt: null,
    });

    await run();

    // A User without its ProjectMember rows, or an invite marked accepted
    // without its User, are states nothing else would repair.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('persists the display name, which Apple only ever sends once', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'viewer', projectIds: [], expiresAt: future, acceptedAt: null,
    });

    await run({ provider: 'apple', name: 'Alex Rivera' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Alex Rivera' }),
    });
  });

  it('lowercases the email so casing cannot bypass the invite match', async () => {
    prisma.invite.findFirst.mockResolvedValue({
      id: 'inv_1', organizationId: orgId, role: 'viewer', projectIds: [], expiresAt: future, acceptedAt: null,
    });

    await run({ email: 'Alex@ACME.com' });

    expect(prisma.invite.findFirst).toHaveBeenCalledWith({ where: { email: 'alex@acme.com' } });
  });

  // ------------------------------------------------------- returning users

  it('lets an existing user back in without needing a fresh invite', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', organizationId: orgId });

    const result = await run();

    expect(result).toEqual({ allowed: true, userId: 'usr_1', organizationId: orgId });
    expect(prisma.invite.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
