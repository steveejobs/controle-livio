import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from '@playwright/test';

test('etapa 3: concorrência, estornos, despesas, rollback e relatórios no PostgreSQL descartável', async () => {
  test.setTimeout(12 * 60_000);
  const snapshot = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
  await promisify(execFile)(
    process.execPath,
    [
      '--test',
      resolve(process.cwd(), 'tools/qa/financial-integrity-support.test.mjs'),
      resolve(process.cwd(), 'tools/qa/financial-security-support.test.mjs'),
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 30000,
    },
  );
  const result = await promisify(execFile)(
    process.execPath,
    [resolve(process.cwd(), 'tools/qa/financial-integrity-ci.mjs')],
    {
      cwd: process.cwd(),
      timeout: 11 * 60_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        LIVIO_FINANCIAL_INTEGRATION: 'disposable',
        LIVIO_AUDIT_SHA: snapshot.stdout.trim(),
      },
    },
  );
  console.log(result.stdout);
});
