import { describe, expect, it } from 'vitest';
import { initialRolePermissions, permissionActions, permissionResources } from './permissions';
import { pipelineTemplates } from './pipelines';

describe('authorization defaults', () => {
  it('grants administrators every resource and action', () => {
    expect(initialRolePermissions.administrator).toHaveLength(
      permissionActions.length * permissionResources.length,
    );
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
