import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const current = process.versions.node.split('.').map(Number);
if (current[0] !== 24) {
  throw new Error('O teste de runtime do OCR precisa usar Node 24.x, igual aos projetos Vercel.');
}

const apiFile = resolve('apps/api/dist/finance/receipt-extraction.service.js');
if (!existsSync(apiFile)) throw new Error('Build da API não gerou o serviço de extração.');
const fromApi = createRequire(apiFile);
const language = fromApi.resolve('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz');
const worker = fromApi.resolve('tesseract.js/src/worker-script/node/index.js');
const core = fromApi.resolve('tesseract.js-core/tesseract-core-simd-lstm.js');
const pdfjs = fromApi.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const canvasModule = fromApi.resolve('@napi-rs/canvas');
for (const path of [language, worker, core, pdfjs, canvasModule]) {
  if (!existsSync(path)) throw new Error('Recurso de runtime ausente no build da API.');
}

// Loading the ESM parser from the exact compiled service location checks the Node API used in production.
fromApi(pdfjs);
const { createCanvas } = fromApi('@napi-rs/canvas');
const { ReceiptExtractionService } = fromApi(apiFile);
const canvas = createCanvas(1500, 300);
const context = canvas.getContext('2d');
context.fillStyle = '#fff';
context.fillRect(0, 0, 1500, 300);
context.fillStyle = '#000';
context.font = '48px Arial';
context.fillText('Valor pago: R$ 25,00', 35, 105);
context.fillText('Data do pagamento: 30/10/2026', 35, 205);

const rssStart = process.memoryUsage().rss;
let peakRss = rssStart;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 25);
const started = performance.now();
try {
  const result = await new ReceiptExtractionService().extract(
    canvas.toBuffer('image/png'),
    'image/png',
  );
  if (
    result.method !== 'OCR' ||
    result.fields.paidAmount?.value !== '25.00' ||
    result.fields.paidDate?.value !== '2026-10-30'
  ) {
    throw new Error('OCR do build da API não reconheceu a fixture sintética esperada.');
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const report = {
    result: 'PASS',
    node: process.versions.node,
    languageModelBytes: statSync(language).size,
    elapsedMs: Math.round(performance.now() - started),
    rssDeltaBytes: process.memoryUsage().rss - rssStart,
    peakRssBytes: peakRss,
    source: 'synthetic-image-local-ocr',
  };
  console.log(JSON.stringify(report));
  if (process.env.RUNNER_TEMP) {
    const evidenceDirectory = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, 'receipt-runtime-validation.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  }
} finally {
  clearInterval(sample);
}
