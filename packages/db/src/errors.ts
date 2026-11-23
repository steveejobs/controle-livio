import { Prisma } from './generated/client';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function postgresErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const adapter = record(error.meta?.driverAdapterError);
  const cause = record(adapter?.cause);
  for (const value of [error.meta?.code, cause?.originalCode]) {
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }
  return undefined;
}

export function matchesUniqueConstraint(
  error: unknown,
  expected: { fieldNames: readonly string[]; indexName: string },
): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const adapter = record(error.meta?.driverAdapterError);
  const cause = record(adapter?.cause);
  const constraint = record(cause?.constraint);
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target : constraint?.fields;
  if (
    Array.isArray(fields) &&
    fields.some(
      (field: unknown) => typeof field === 'string' && expected.fieldNames.includes(field),
    )
  )
    return true;
  const index = typeof target === 'string' ? target : constraint?.index;
  return index === expected.indexName;
}
