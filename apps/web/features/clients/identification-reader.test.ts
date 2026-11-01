import { describe, expect, it } from 'vitest';
import { parseIdentificationText } from './identification-reader';

describe('leitura de dados de documento', () => {
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
});
