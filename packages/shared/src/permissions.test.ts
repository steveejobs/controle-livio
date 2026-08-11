import { describe, expect, it } from 'vitest';
import { initialRolePermissions, permissionActions, permissionResources } from './permissions';
import { pipelineTemplates } from './pipelines';

describe('authorization defaults', () => {
  it('grants administrators every resource and action', () => {
    expect(initialRolePermissions.administrator).toHaveLength(
      permissionActions.length * permissionResources.length,
    );
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
