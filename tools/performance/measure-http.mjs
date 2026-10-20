import { performance } from 'node:perf_hooks';

const target = new URL(process.argv[2] ?? 'http://127.0.0.1:3010/');
const requests = Number(process.argv[3] ?? 50);
const concurrency = Number(process.argv[4] ?? 5);
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) {
  throw new Error('Use apenas uma URL HTTP local (127.0.0.1 ou localhost).');
}
if (!Number.isInteger(requests) || requests < 1 || requests > 100) {
  throw new Error('Número de requisições deve ficar entre 1 e 100.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error('Concorrência deve ficar entre 1 e 8.');
}

async function sample() {
  const started = performance.now();
  const response = await fetch(target, { method: 'GET', signal: AbortSignal.timeout(15_000) });
  await response.arrayBuffer();
  return { status: response.status, milliseconds: performance.now() - started };
}

await sample();
const outcomes = new Array(requests);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, requests) }, async () => {
    while (next < requests) {
      const index = next++;
      try {
        outcomes[index] = await sample();
      } catch (error) {
        outcomes[index] = { error: error instanceof Error ? error.name : 'UnknownError' };
      }
    }
  }),
);

const successful = outcomes
  .filter((item) => item?.status >= 200 && item.status < 400)
  .map((item) => item.milliseconds)
  .sort((a, b) => a - b);
const percentile = (value) =>
  successful.length
    ? Math.round(successful[Math.ceil((value / 100) * successful.length) - 1])
    : null;
const statusCounts = {};
for (const item of outcomes) {
  const key = String(item.status ?? item.error);
  statusCounts[key] = (statusCounts[key] ?? 0) + 1;
}
console.log(
  JSON.stringify({
    url: target.href,
    requests,
    concurrency,
    statusCounts,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
  }),
);
if (successful.length !== requests) process.exitCode = 1;
