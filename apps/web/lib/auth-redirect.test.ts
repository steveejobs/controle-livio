import { describe, expect, it } from 'vitest';
import { authenticationDestination } from './auth-redirect';

describe('destino após autenticação', () => {
  it('mantém destinos internos e rejeita redirecionamentos para outra origem', () => {
    const origin = 'https://livio.example.com';
    expect(authenticationDestination('/reset-password', origin)).toBe('/reset-password');
    expect(authenticationDestination(null, origin)).toBe('/');
    expect(authenticationDestination('//attacker.example', origin)).toBeUndefined();
    expect(authenticationDestination('/\\attacker.example', origin)).toBeUndefined();
    expect(authenticationDestination('https://attacker.example', origin)).toBeUndefined();
    expect(authenticationDestination('javascript:alert(1)', origin)).toBeUndefined();
  });
});
