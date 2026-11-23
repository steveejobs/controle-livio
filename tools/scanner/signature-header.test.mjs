import assert from 'node:assert/strict';
import test from 'node:test';
import { definitionAge } from './signature-header.mjs';

const now = 1_800_000_000_000;
const header = (seconds, prefix = 'ClamAV-VDB') =>
  Buffer.from(`${prefix}:synthetic-date:1:1:1:md5:signature:builder:${seconds}`.padEnd(512, ' '));
test('uses the signed database header timestamp rather than the file copy time', () => {
  assert.equal(definitionAge(header(now / 1000 - 3600), now), 3600_000);
});
test('rejects missing or malformed vendor headers', () => {
  for (const value of [Buffer.alloc(0), header('invalid'), header(now / 1000, 'other')])
    assert.throws(() => definitionAge(value, now));
});
test('rejects definitions older than 48 hours', () => {
  assert.throws(() => definitionAge(header(now / 1000 - 48 * 3600 - 1), now));
});
test('rejects timestamps ahead of allowed clock skew', () => {
  assert.throws(() => definitionAge(header(now / 1000 + 301), now));
});
