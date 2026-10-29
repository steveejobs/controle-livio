import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const destinationDirectory = resolve(workspaceRoot, 'apps/web/public/ocr');
const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'apps/web/public/ocr/worker.min.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core.wasm.js',
    'apps/web/public/ocr/tesseract-core.wasm.js',
  ],
  [
    'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz',
    'apps/web/public/ocr/por.traineddata.gz',
  ],
];

await mkdir(destinationDirectory, { recursive: true });
for (const [source, destination] of assets) {
  await copyFile(resolve(workspaceRoot, source), resolve(workspaceRoot, destination));
}
