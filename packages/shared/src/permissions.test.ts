import { describe, expect, it } from 'vitest';
import { initialRolePermissions, permissionActions, permissionResources } from './permissions';
import { pipelineTemplates } from './pipelines';

describe('authorization defaults', () => {
  it('grants all existing actions and only explicit recovery view/manage', () => {
    expect(initialRolePermissions.administrator).toHaveLength(
      permissionActions.length * (permissionResources.length - 1) + 2,
    );
    expect(initialRolePermissions.administrator).toContain('storage_recovery:view');
    expect(initialRolePermissions.administrator).toContain('storage_recovery:manage');
    for (const role of ['lawyer', 'secretary', 'finance', 'client'] as const)
      expect(
        initialRolePermissions[role].some((code) => code.startsWith('storage_recovery:')),
      ).toBe(false);
  });

  it('reserva a exportação de relatórios ao perfil Administrador', () => {
    expect(initialRolePermissions.administrator).toContain('reports:export');
    expect(initialRolePermissions.lawyer).not.toContain('reports:export');
    expect(initialRolePermissions.secretary).not.toContain('reports:export');
    expect(initialRolePermissions.finance).not.toContain('reports:export');
  });

  it('defines all required configurable pipeline kinds', () => {
    expect(pipelineTemplates.map(({ kind }) => kind)).toEqual([
      'COMMERCIAL',
      'LEGAL',
      'COLLECTION',
    ]);
    expect(pipelineTemplates.every(({ stages }) => stages.some(({ terminal }) => terminal))).toBe(
      true,
    );
  });
});
