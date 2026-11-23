import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from '@playwright/test';

test('identity API, PostgreSQL, Auth and Storage consistency on disposable stack', async () => {
  test.setTimeout(4 * 60_000);
  await promisify(execFile)(
    process.execPath,
    ['--test', resolve('tools/qa/identity-environment.test.mjs')],
    { cwd: process.cwd(), windowsHide: true, timeout: 30000 },
  );
  await promisify(execFile)(process.execPath, [resolve('tools/qa/identity-integrity-ci.mjs')], {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 3 * 60_000,
    maxBuffer: 512 * 1024,
    env: { ...process.env, LIVIO_IDENTITY_INTEGRATION: 'disposable' },
  });
});
