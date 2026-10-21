import { describe, expect, it } from 'vitest';
import { DEFAULT_LEGAL_SERVICES, normalizeLegalServiceName } from './legal-services';

describe('legal service catalog', () => {
  it('includes common criminal services', () => {
    expect(DEFAULT_LEGAL_SERVICES).toContainEqual({
      name: 'Acompanhamento em delegacia',
      area: 'CRIMINAL',
    });
    expect(DEFAULT_LEGAL_SERVICES.some(({ area }) => area === 'CRIMINAL')).toBe(true);
  });

  it('normalizes names for duplicate checks', () => {
    expect(normalizeLegalServiceName('  AÇÃO   PENAL ')).toBe('acao penal');
  });
});
