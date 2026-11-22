import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { verifyUpload } from './verify-upload.mjs';

function fixture(context, rules) {
  const root = mkdtempSync(join(tmpdir(), 'livio-upload-contract-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  for (const file of [
    'apps/api/src/reports/reports.module.ts',
    'apps/web/features/reports/report-panel.tsx',
    'packages/shared/src/index.ts',
    'reports/summary.json',
    'docs/README.md',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'synthetic\n');
  }
  writeFileSync(join(root, '.vercelignore'), rules);
  execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '--all'], {
    cwd: root,
    windowsHide: true,
  });
  return root;
}

test('unanchored artifact rule rejects the real reports module and UI paths', (context) => {
  const root = fixture(context, 'reports/\n');
  assert.throws(() => verifyUpload(root), /apps\/api\/src\/reports\/reports.module.ts/);
});

test('root artifact exclusions preserve runtime sources and exclude generated reports', (context) => {
  const root = fixture(context, '/reports/\n/docs/\n');
  assert.deepEqual(verifyUpload(root), { result: 'PASS', checkedSources: 3 });
  const ignored = execFileSync(
    'git',
    ['ls-files', '--cached', '--ignored', '--exclude-from=.vercelignore'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split('\n');
  assert.deepEqual(ignored, ['docs/README.md', 'reports/summary.json']);
});

test('source exclusions cannot be hidden by a separate gitignore negation', (context) => {
  const root = fixture(context, 'reports/\n');
  writeFileSync(join(root, '.gitignore'), '!apps/api/src/reports/\n');
  assert.throws(() => verifyUpload(root), /Vercel upload excludes/);
});
