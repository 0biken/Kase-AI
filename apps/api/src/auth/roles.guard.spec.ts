import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Principal } from './principal';

function ctxWithRole(role: Principal['role'] | undefined) {
  const req = { principal: { role } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows any role when the route carries no @Roles() — matches viewer read access', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);
    expect(guard.canActivate(ctxWithRole('viewer'))).toBe(true);
  });

  it('allows a role that is in the allowlist', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['admin']);
    expect(guard.canActivate(ctxWithRole('admin'))).toBe(true);
  });

  it('rejects a role that is not in the allowlist', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['admin']);
    expect(() => guard.canActivate(ctxWithRole('operator'))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('operator does not satisfy an approver-only route, and vice versa — no hierarchy', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['approver']);
    expect(() => guard.canActivate(ctxWithRole('operator'))).toThrow();

    reflector.getAllAndOverride = jest.fn().mockReturnValue(['operator']);
    expect(() => guard.canActivate(ctxWithRole('approver'))).toThrow();
  });

  it('admin does not implicitly satisfy every route — set membership only', () => {
    // Documents the choice explicitly: this guard never treats admin as a
    // superset of the other roles. A route that wants admin-or-viewer must
    // list both.
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['approver']);
    expect(() => guard.canActivate(ctxWithRole('admin'))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects when the principal has no role at all', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['admin']);
    expect(() => guard.canActivate(ctxWithRole(undefined))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
