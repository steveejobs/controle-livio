import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTree } from './volume-copy.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'livio-copy-contract-'));
  const source = join(root, 'source'),
    destination = join(root, 'destination');
  mkdirSync(source);
  mkdirSync(destination);
  mkdirSync(join(source, 'tenant'));
  writeFileSync(join(source, 'tenant', 'object.bin'), 'synthetic-object-bytes');
  return { source, destination };
}

test('restore explicitly accepts matching empty directories without overwriting a file', () => {
  const { source, destination } = fixture();
  mkdirSync(join(destination, 'tenant'));
  assert.throws(() => copyTree(source, destination), /Destination must be empty/);
  const files = copyTree(source, destination, { allowEmptyDirectorySkeleton: true });
  assert.equal(files.length, 1);
  assert.equal(
    readFileSync(join(destination, 'tenant', 'object.bin'), 'utf8'),
    'synthetic-object-bytes',
  );
  assert.equal(
    readFileSync(join(source, 'tenant', 'object.bin'), 'utf8'),
    'synthetic-object-bytes',
  );
});

test('even explicit restore refuses existing destination bytes and preserves them', () => {
  const { source, destination } = fixture();
  mkdirSync(join(destination, 'tenant'));
  writeFileSync(join(destination, 'tenant', 'object.bin'), 'preserved-original');
  assert.throws(() => copyTree(source, destination, { allowEmptyDirectorySkeleton: true }), {
    code: 'STORAGE_COPY_UNSAFE_DESTINATION',
  });
  assert.equal(
    readFileSync(join(destination, 'tenant', 'object.bin'), 'utf8'),
    'preserved-original',
  );
});

test('unrelated destination directories stop before copying source bytes', () => {
  const { source, destination } = fixture();
  mkdirSync(join(destination, 'unrelated'));
  assert.throws(() => copyTree(source, destination, { allowEmptyDirectorySkeleton: true }), {
    code: 'STORAGE_COPY_UNSAFE_DESTINATION',
  });
  assert.deepEqual(readdirSync(destination), ['unrelated']);
});
