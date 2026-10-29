import { describe, expect, it } from 'vitest';
import { dueAccessAlertTime } from './access-alert-schedule';

describe('horários do resumo de acessos', () => {
  it('recupera um horário mesmo quando o agendador executa atrasado', () => {
    expect(
      dueAccessAlertTime(
        new Date('2026-10-21T12:04:30Z'),
        new Date('2026-10-21T11:59:00Z'),
        'America/Sao_Paulo',
        ['09:00'],
      ),
    ).toBe('09:00');
  });
  it('não repete o resumo depois de avançar o cursor', () => {
    expect(
      dueAccessAlertTime(
        new Date('2026-10-21T12:05:00Z'),
        new Date('2026-10-21T12:04:30Z'),
        'America/Sao_Paulo',
        ['09:00'],
      ),
    ).toBeUndefined();
  });
  it('respeita virada de dia e mudanças de fuso', () => {
    expect(
      dueAccessAlertTime(
        new Date('2026-10-22T03:01:00Z'),
        new Date('2026-10-22T02:58:00Z'),
        'America/Sao_Paulo',
        ['00:00'],
      ),
    ).toBe('00:00');
    expect(
      dueAccessAlertTime(
        new Date('2026-11-01T06:31:00Z'),
        new Date('2026-11-01T06:29:00Z'),
        'America/New_York',
        ['01:30'],
      ),
    ).toBe('01:30');
  });
});
