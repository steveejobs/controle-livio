import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './permission.guard';

function context(permissions: string[], isAdministrator = false): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ actor: { permissions, isAdministrator } }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('autoriza somente a ação granular exigida', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce('payments:approve')
        .mockReturnValueOnce(false),
    };
    expect(new PermissionGuard(reflector as never).canActivate(context(['payments:approve']))).toBe(
      true,
    );
  });

  it('nega rota sem política e permissão ausente', () => {
    const noPolicy = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(undefined),
    };
    expect(() => new PermissionGuard(noPolicy as never).canActivate(context([]))).toThrow(
      ForbiddenException,
    );
    const missing = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce('payments:approve')
        .mockReturnValueOnce(false),
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
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    };
    expect(new PermissionGuard(reflector as never).canActivate(context([]))).toBe(true);
  });

  it('restringe rotas de administrador ao papel oficial, mesmo com outras permissões', () => {
    const createGuard = () => ({
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true),
    });
    expect(() =>
      new PermissionGuard(createGuard() as never).canActivate(context(['users:manage'])),
    ).toThrow(ForbiddenException);
    expect(new PermissionGuard(createGuard() as never).canActivate(context([], true))).toBe(true);
  });

  it('exige papel oficial e permissao especifica em rotas administrativas', () => {
    const makeReflector = () => ({
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce('audit:view')
        .mockReturnValueOnce(true),
    });
    expect(() =>
      new PermissionGuard(makeReflector() as never).canActivate(context(['audit:view'])),
    ).toThrow(ForbiddenException);
    expect(
      new PermissionGuard(makeReflector() as never).canActivate(context(['audit:view'], true)),
    ).toBe(true);
  });
});
