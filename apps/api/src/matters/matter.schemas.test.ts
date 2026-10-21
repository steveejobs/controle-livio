import { describe, expect, it } from 'vitest';
import { createMatterSchema } from './matter.schemas';

const validMatter = {
  clientId: '11111111-1111-4111-8111-111111111111',
  reference: 'COB-001',
  title: 'Negociar documentação',
  labels: [],
};

describe('collection objective validation', () => {
  it('accepts an objective description without requiring or creating a financial amount', () => {
    const result = createMatterSchema.safeParse({
      ...validMatter,
      pipelineId: '22222222-2222-4222-8222-222222222222',
      collectionObjective: {
        description: 'Obter os documentos pendentes para concluir a cobrança.',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('amount');
  });

  it('requires a useful description when the objective option is confirmed', () => {
    expect(
      createMatterSchema.safeParse({ ...validMatter, collectionObjective: { description: ' ' } })
        .success,
    ).toBe(false);
  });
});
