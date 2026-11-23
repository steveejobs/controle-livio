import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppPhone } from './whatsapp-collection';

describe('destinatário de cobrança no WhatsApp', () => {
  it('adiciona o código do Brasil a um telefone com DDD', () => {
    expect(normalizeWhatsAppPhone('(98) 99999-1234')).toBe('5598999991234');
  });

  it('preserva números internacionais explícitos', () => {
    expect(normalizeWhatsAppPhone('+1 (415) 555-0199')).toBe('14155550199');
  });

  it('recusa números sem DDD ou incompletos', () => {
    expect(normalizeWhatsAppPhone('99999-1234')).toBeNull();
    expect(normalizeWhatsAppPhone('')).toBeNull();
  });
});
