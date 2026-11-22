import { describe, expect, it } from 'vitest';
import { Prisma } from './generated/client';
import { matchesUniqueConstraint } from './errors';

const expected = {
  fieldNames: ['tax_id_normalized', 'taxIdNormalized'],
  indexName: 'clients_organization_id_tax_id_normalized_key',
};
const conflict = (meta: Record<string, unknown>, code = 'P2002') =>
  new Prisma.PrismaClientKnownRequestError('Synthetic conflict', {
    code,
    clientVersion: '7.10.1',
    meta,
  });

describe('unique constraint compatibility across Prisma drivers', () => {
  it.each([
    { target: ['organization_id', 'tax_id_normalized'] },
    { target: ['taxIdNormalized'] },
    { driverAdapterError: { cause: { constraint: { fields: ['tax_id_normalized'] } } } },
    { driverAdapterError: { cause: { constraint: { index: expected.indexName } } } },
  ])('recognizes reviewed column/index metadata: %j', (meta) => {
    expect(matchesUniqueConstraint(conflict(meta), expected)).toBe(true);
  });

  it.each([
    { target: ['email'] },
    { driverAdapterError: { cause: { constraint: { index: expected.indexName + '_other' } } } },
    { driverAdapterError: { cause: null } },
    {},
  ])('never reclassifies an unrelated or malformed constraint: %j', (meta) => {
    expect(matchesUniqueConstraint(conflict(meta), expected)).toBe(false);
  });

  it('requires the Prisma unique-violation code and a real Prisma error', () => {
    expect(
      matchesUniqueConstraint(conflict({ target: ['tax_id_normalized'] }, 'P2003'), expected),
    ).toBe(false);
    expect(
      matchesUniqueConstraint({ code: 'P2002', meta: { target: ['tax_id_normalized'] } }, expected),
    ).toBe(false);
  });
});
