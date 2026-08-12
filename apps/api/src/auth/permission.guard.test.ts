import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './permission.guard';

function context(permissions: string[]): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ actor: { permissions } }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('autoriza somente a ação granular exigida', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce('payments:approve'),
    };
    expect(new PermissionGuard(reflector as never).canActivate(context(['payments:approve']))).toBe(
      true,
    );
  });

  it('nega rota sem política e permissão ausente', () => {
    const noPolicy = {
      getAllAndOverride: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(undefined),
    };
    expect(() => new PermissionGuard(noPolicy as never).canActivate(context([]))).toThrow(
      ForbiddenException,
    );
    const missing = {
      getAllAndOverride: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce('payments:approve'),
    };
    expect(() =>
      new PermissionGuard(missing as never).canActivate(context(['payments:view'])),
    ).toThrow(ForbiddenException);
  });

  it('autoriza rota explicitamente marcada para qualquer sessão autenticada', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(true),
    };
    expect(new PermissionGuard(reflector as never).canActivate(context([]))).toBe(true);
  });
});
