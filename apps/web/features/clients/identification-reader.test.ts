import { describe, expect, it } from 'vitest';
import { parseIdentificationText } from './identification-reader';

describe('leitura de dados de documento', () => {
  it.each([
    ['RG: MG-1234567\nSSP/MG', 'MG-1234567'],
    ['CPF: 529.982.247-25\nRG: 12.345.678-X', '12.345.678-X'],
    ['REGISTRO GERAL\n1234567\nSSP/MA', '1234567'],
    ['RG:\nSSP/MA', undefined],
    ['RG:\nILEGIVEL', undefined],
  ])('preserva o número ou ausência em %s', (text, expected) => {
    expect(parseIdentificationText(text).rg).toBe(expected);
  });
  it('extrai nome, CPF, RG, órgão expedidor e nascimento de linhas rotuladas', () => {
    expect(
      parseIdentificationText(`
      REPUBLICA FEDERATIVA DO BRASIL
      NOME
      MARIA DA SILVA SOUZA
      RG: 123456789
      SSP/MA
      CPF: 529.982.247-25
      DATA DE NASCIMENTO
      24/05/1990
    `),
    ).toEqual({
      name: 'MARIA DA SILVA SOUZA',
      cpf: '52998224725',
      rg: '123456789',
      issuingAuthority: 'SSP/MA',
      birthDate: '1990-05-24',
    });
  });

  it('aceita nome e documento na mesma linha e descarta data impossível', () => {
    expect(
      parseIdentificationText('NOME: ANA PEREIRA\nREGISTRO GERAL 1234567\nNASCIMENTO 31/02/1990'),
    ).toEqual({
      name: 'ANA PEREIRA',
      rg: '1234567',
    });
  });

  it('não inventa valores quando o texto não identifica campos', () => {
    expect(parseIdentificationText('DOCUMENTO SEM TEXTO LEGÍVEL')).toEqual({});
  });

  it('não interpreta o órgão expedidor como número de RG quando o número está ilegível', () => {
    expect(parseIdentificationText('NOME: ANA PEREIRA\nRG:\nSSP/MA\nCPF: 529.982.247-25')).toEqual({
      name: 'ANA PEREIRA',
      cpf: '52998224725',
      issuingAuthority: 'SSP/MA',
    });
  });
});
