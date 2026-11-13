import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { copyTree } from './volume-copy.mjs';
import { delayedProvider } from './delayed-provider.mjs';
import { projectName } from './stack-identity.mjs';

test('real buffered HTTP request reaches provider only after client timeout, with identical bytes', async () => {
  const expected = Buffer.from('SYNTHETIC LATE WRITE - NO LEGAL VALUE');
  let observed;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    observed = Buffer.concat(chunks);
    res.writeHead(201);
    res.end('{}');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const url = `http://127.0.0.1:${provider.address().port}/storage/v1/object/synthetic/test`;
  const barrier = await delayedProvider(url, { timeoutMs: 150 });
  try {
    const request = barrier.request(url, { method: 'POST', body: expected });
    const rejection = assert.rejects(request, (e) =>
      ['TimeoutError', 'AbortError'].includes(e.name),
    );
    await barrier.received;
    await rejection;
    const timeout = Date.now();
    assert.equal(observed, undefined);
    barrier.release();
    const actual = await barrier.result;
    assert.equal(actual.status, 201);
    assert.ok(actual.providerCompletedAt >= timeout);
    assert.deepEqual(observed, expected);
  } finally {
    await barrier.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
});
test('transport refuses external provider addresses before opening a listener', async () => {
  await assert.rejects(delayedProvider('https://external.invalid/storage/v1/object/test'));
});
test('project identity cannot select another project or a shell expression', () => {
  assert.equal(projectName({}), 'livio-legal-crm');
  assert.equal(
    projectName({ LIVIO_RECOVERY_PROJECT: 'livio-recovery-123-abcdef12' }),
    'livio-recovery-123-abcdef12',
  );
  for (const value of [
    'production',
    'other-project',
    'livio-recovery-1-zzzzzzzz',
    '../../test',
    '$(secret)',
  ])
    assert.throws(() => projectName({ LIVIO_RECOVERY_PROJECT: value }));
});
test('physical backup copier preserves nested bytes/hash and refuses overwriting destination', () => {
  const root = mkdtempSync(join(tmpdir(), 'livio-recovery-volume-unit-')),
    source = join(root, 'source'),
    destination = join(root, 'destination');
  mkdirSync(source);
  mkdirSync(destination);
  mkdirSync(join(source, 'nested'));
  writeFileSync(join(source, 'nested', 'fixture.bin'), Buffer.from([0, 255, 13, 10, 7]));
  try {
    const files = copyTree(source, destination);
    assert.equal(files.length, 1);
    assert.equal(files[0].size, 5);
    assert.deepEqual(
      readFileSync(join(destination, 'nested', 'fixture.bin')),
      readFileSync(join(source, 'nested', 'fixture.bin')),
    );
    assert.throws(() => copyTree(source, destination), /empty/);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});
