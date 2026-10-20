import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const budget = 260_000;
const nextRoot = resolve('apps/web/.next');
const html = await readFile(resolve(nextRoot, 'server/app/index.html'), 'utf8');
const scripts = [
  ...new Set(
    [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((src) => src?.startsWith('/_next/static/')),
  ),
];
if (scripts.length === 0) throw new Error('Nenhum script inicial encontrado no build da web.');

let total = 0;
for (const src of scripts) {
  const file = resolve(nextRoot, src.slice('/_next/'.length));
  if (!file.startsWith(`${nextRoot}${sep}`)) throw new Error('Script fora do build da web.');
  total += gzipSync(await readFile(file)).byteLength;
}

console.log(
  `JavaScript inicial: ${scripts.length} scripts, ${total} bytes gzip (limite ${budget}).`,
);
if (total > budget) process.exitCode = 1;
