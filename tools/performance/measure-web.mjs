import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const address = process.argv[2] ?? 'http://127.0.0.1:3010/';
const url = new URL(address);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('Use apenas uma URL HTTP local (127.0.0.1 ou localhost).');
}

async function get(path) {
  const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${path}`);
  return response.text();
}

const html = await get('/');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((src) => src?.startsWith('/_next/static/'));
const uniqueScripts = [...new Set(scripts)];
const sizes = await Promise.all(
  uniqueScripts.map(async (src) => ({
    path: src,
    gzipBytes: gzipSync(await get(src)).byteLength,
  })),
);

const timings = [];
for (let sample = 0; sample < 5; sample += 1) {
  const start = performance.now();
  await get('/');
  timings.push(Math.round(performance.now() - start));
}

console.log(
  JSON.stringify(
    {
      url: url.origin,
      initialScriptCount: uniqueScripts.length,
      initialScriptGzipBytes: sizes.reduce((total, item) => total + item.gzipBytes, 0),
      largestScripts: sizes.sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 3),
      warmedHtmlMs: timings,
    },
    null,
    2,
  ),
);
