import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIdentificationText, type IdentificationData } from './identification-reader';

const cases = JSON.parse(
  readFileSync(
    new URL('../../../../tools/qa/fixtures/identity/cases.json', import.meta.url),
    'utf8',
  ),
) as Array<{ id: string; text: string; expected: IdentificationData }>;

describe('identity corpus: textual interpretation only, not optical recognition', () => {
  it.each(cases)('$id preserves field identity and omissions', ({ text, expected }) => {
    expect(parseIdentificationText(text)).toEqual(expected);
  });
  it('preserves accents and apostrophes in a labeled name', () => {
    expect(parseIdentificationText('NOME: JOÃO SINTÉTICO D’TESTE').name).toBe(
      'JOÃO SINTÉTICO D’TESTE',
    );
  });
  it('does not guess damaged letters in a name', () => {
    expect(parseIdentificationText('NOME: JO?O SINTETICO')).toEqual({});
  });
});
