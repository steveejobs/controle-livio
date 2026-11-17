import { createCanvas } from '@napi-rs/canvas';

export const identityOcrGroundTruth = {
  name: 'PESSOA SINTETICA ARAUJO',
  cpf: '52998224725',
  rg: '1234567',
  issuingAuthority: 'SSP/MA',
  birthDate: '1990-05-24',
} as const;

// Fixed legible synthetic source, shared by optical qualification and real persistence E2E.
// The random current form CPF remains distinct and must survive rejection of this suggestion.
export function identityOcrFixture() {
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = '#111';
  ctx.font = '32px Arial';
  ctx.fillText('TESTE SINTETICO - SEM VALIDADE', 50, 55);
  ctx.font = '48px Arial';
  [
    'NOME: ' + identityOcrGroundTruth.name,
    'CPF: 529.982.247-25',
    'RG: ' + identityOcrGroundTruth.rg,
    identityOcrGroundTruth.issuingAuthority,
    'NASCIMENTO: 24/05/1990',
  ].forEach((line, i) => ctx.fillText(line, 55, 160 + i * 120));
  return canvas.toBuffer('image/png');
}
