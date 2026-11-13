import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const cases = JSON.parse(readFileSync(new URL('./fixtures/identity/cases.json', import.meta.url)));
const source = 'apps/web/features/clients/identification-reader.ts';
const fields = ['name', 'cpf', 'rg', 'issuingAuthority', 'birthDate'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parser(text) {
  const ts = require('typescript');
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('exports', outputText)(exports);
  return exports.parseIdentificationText;
}

export function compareFields(expected, observed) {
  return fields.map((field) => ({
    field,
    expected: expected[field] ?? null,
    observed: observed[field] ?? null,
    result:
      expected[field] === observed[field]
        ? expected[field] === undefined
          ? 'CORRECT_ABSENCE'
          : 'MATCH'
        : expected[field] === undefined
          ? 'INVENTION'
          : observed[field] === undefined
            ? 'OMISSION'
            : 'WRONG_VALUE',
  }));
}

export async function runIdentityCorpus(output) {
  if (existsSync(output)) throw new Error('Refusing to overwrite an existing corpus directory');
  mkdirSync(output, { recursive: true });
  const { createCanvas } = require('@napi-rs/canvas');
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const { createWorker } = require('tesseract.js');
  const current = parser(readFileSync(source, 'utf8'));
  const previous = parser(execFileSync('git', ['show', 'HEAD:' + source], { encoding: 'utf8' }));
  const manifest = {
    schema: 1,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    candidateParserSha256: hash(readFileSync(source)),
    source: 'Hand-authored ground truth; canvas-generated test placards, never official ID layouts',
    warning: 'Synthetic nonrepresentative sample. No authenticity, QR, MRZ or barcode validation.',
    textual: cases.map((item) => ({
      ...item,
      before: previous(item.text),
      after: current(item.text),
      beforeFields: compareFields(item.expected, previous(item.text)),
      afterFields: compareFields(item.expected, current(item.text)),
    })),
    fixtures: [],
    optical: [],
    unsupportedFields: [
      'parentage',
      'separateUF',
      'issueDate',
      'expiryDate',
      'cnhRegistration',
      'cnhCategory',
    ],
  };
  const specifications = [
    ['rg-clean', 'ID-T01', 'png', 'clean'],
    ['rg-order-jpeg', 'ID-T04', 'jpeg', 'clean'],
    ['cin-clean', 'ID-T13', 'png', 'clean'],
    ['cnh-clean', 'ID-T14', 'jpeg', 'clean'],
    ['cpf-invalid', 'ID-T11', 'png', 'clean'],
    ['rg-missing-number', 'ID-T02', 'png', 'clean'],
    ['rg-back', 'ID-T19', 'png', 'clean'],
    ['rg-rotate12', 'ID-T01', 'jpeg', 'rotate12'],
    ['cin-rotate90', 'ID-T13', 'png', 'rotate90'],
    ['rg-lowres', 'ID-T04', 'jpeg', 'lowres'],
    ['rg-blur', 'ID-T01', 'jpeg', 'blur'],
    ['rg-reflection', 'ID-T01', 'jpeg', 'reflection'],
    ['rg-redacted-cpf', 'ID-T01', 'png', 'redact'],
    ['rg-cropped-right', 'ID-T01', 'jpeg', 'crop'],
  ];
  for (const [id, caseId, format, variant] of specifications) {
    const item = cases.find((value) => value.id === caseId);
    assert(item);
    const canvas = createCanvas(1600, 1000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee7d8';
    ctx.fillRect(0, 0, 1600, 1000);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('TESTE SINTETICO - SEM VALIDADE - NAO E IDENTIFICACAO', 45, 55);
    ctx.save();
    if (variant === 'rotate12') {
      ctx.translate(180, -25);
      ctx.rotate((12 * Math.PI) / 180);
    }
    if (variant === 'blur') ctx.filter = 'blur(2px)';
    ctx.font = '44px Arial';
    item.text.split('\n').forEach((line, index) => ctx.fillText(line, 65, 160 + index * 110));
    ctx.restore();
    if (variant === 'reflection') {
      ctx.fillStyle = '#ffffffbb';
      ctx.fillRect(300, 220, 1000, 110);
    }
    const expected = { ...item.expected };
    if (variant === 'redact') {
      ctx.fillStyle = '#eee7d8';
      ctx.fillRect(45, 220, 1500, 75);
      delete expected.cpf;
    }
    let rendered = canvas;
    if (variant === 'crop') {
      rendered = createCanvas(670, 1000);
      rendered.getContext('2d').drawImage(canvas, 0, 0);
    }
    if (variant === 'lowres') {
      rendered = createCanvas(520, 325);
      rendered.getContext('2d').drawImage(canvas, 0, 0, 520, 325);
    }
    if (variant === 'rotate90') {
      rendered = createCanvas(1000, 1600);
      const r = rendered.getContext('2d');
      r.translate(1000, 0);
      r.rotate(Math.PI / 2);
      r.drawImage(canvas, 0, 0);
    }
    const bytes =
      format === 'png'
        ? rendered.toBuffer('image/png')
        : rendered.toBuffer('image/jpeg', variant === 'lowres' ? 32 : 85);
    const file = join(output, `${id}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    writeFileSync(file, bytes);
    manifest.fixtures.push({
      id,
      caseId,
      type: item.type,
      format,
      variant,
      file,
      sha256: hash(bytes),
      bytes: bytes.length,
      expected,
      synthetic: true,
    });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const caseId of ['ID-T01', 'ID-T19']) {
    const page = pdf.addPage([800, 600]);
    const item = cases.find((value) => value.id === caseId);
    page.drawText('TESTE SINTETICO - SEM VALIDADE', { x: 35, y: 550, size: 18, font });
    page.drawText(item.text, { x: 35, y: 490, size: 17, lineHeight: 36, font });
  }
  const scan = await PDFDocument.create();
  for (const id of ['rg-clean', 'rg-back']) {
    const fixture = manifest.fixtures.find((value) => value.id === id);
    const img = await scan.embedPng(readFileSync(fixture.file));
    scan.addPage([800, 500]).drawImage(img, { x: 0, y: 0, width: 800, height: 500 });
  }
  for (const [name, bytes] of [
    ['text-front-back.pdf', await pdf.save()],
    ['scan-front-back.pdf', await scan.save()],
    ['corrupt.pdf', Buffer.from('%PDF-1.7\nINVALID SYNTHETIC')],
    ['corrupt.png', Buffer.from('INVALID SYNTHETIC IMAGE')],
  ]) {
    writeFileSync(join(output, name), bytes);
    manifest.fixtures.push({
      id: name,
      format: name.split('.').at(-1),
      sha256: hash(bytes),
      bytes: bytes.length,
      identityUiSupported: false,
      reason: name.startsWith('corrupt')
        ? 'corrupt input must fail'
        : 'identity UI accepts JPEG/PNG only; not an OCR PDF test',
    });
  }
  const worker = await createWorker('por', 1, {
    langPath: resolve('node_modules/@tesseract.js-data/por/4.0.0_best_int'),
    cacheMethod: 'none',
    errorHandler: () => {
      /* recognize still rejects; suppress the library's uncaught throw */
    },
  });
  try {
    for (const fixture of manifest.fixtures.filter((item) => item.file)) {
      const started = performance.now();
      const { data } = await worker.recognize(fixture.file);
      const interpreted = current(data.text);
      manifest.optical.push({
        id: fixture.id,
        type: fixture.type,
        expected: fixture.expected,
        ocrText: data.text,
        confidence: data.confidence,
        milliseconds: Math.round(performance.now() - started),
        interpretedBefore: previous(data.text),
        interpreted,
        fields: compareFields(fixture.expected, interpreted),
        humanReviewRequired: true,
        applicationToForm: 'NOT_EXECUTED',
      });
    }
    const metrics = {};
    for (const row of manifest.optical)
      for (const field of row.fields) {
        const key = row.type + ':' + field.field;
        metrics[key] ??= {
          samples: 0,
          MATCH: 0,
          CORRECT_ABSENCE: 0,
          INVENTION: 0,
          OMISSION: 0,
          WRONG_VALUE: 0,
        };
        metrics[key].samples++;
        metrics[key][field.result]++;
      }
    manifest.metrics = metrics;
    manifest.corruptImage = await worker.recognize(join(output, 'corrupt.png')).then(
      () => 'UNEXPECTED_ACCEPTANCE',
      () => 'REJECTED',
    );
  } finally {
    await worker.terminate();
  }
  writeFileSync(
    join(output, 'identity-corpus-results.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Provide a new output directory; originals are never overwritten');
  const result = await runIdentityCorpus(resolve(output));
  console.log(
    JSON.stringify({
      sha: result.sha,
      fixtures: result.fixtures.length,
      optical: result.optical.length,
      metrics: result.metrics,
      corruptImage: result.corruptImage,
    }),
  );
}
