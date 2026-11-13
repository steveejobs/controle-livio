import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateRecoveryEnvironment } from './environment.mjs';
import { projectName, docker } from './stack-identity.mjs';

validateRecoveryEnvironment();
const file = resolve(process.env.LIVIO_QA_OUTPUT, 'recovery-target.json');
if (existsSync(file)) {
  const { project } = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(projectName({ LIVIO_RECOVERY_PROJECT: project }), project);
  assert.ok(project.startsWith(`livio-recovery-${process.env.GITHUB_RUN_ID}-`));
  const ids = docker([
    'ps',
    '-a',
    '--filter',
    `label=com.supabase.cli.project=${project}`,
    '--format',
    '{{.ID}}',
  ])
    .toString()
    .trim();
  if (ids) {
    try {
      execFileSync(
        resolve('node_modules/.bin/supabase'),
        ['stop', '--project-id', project, '--no-backup'],
        { stdio: 'ignore' },
      );
    } catch {
      throw new Error('OWN_RECOVERY_TARGET_CLEANUP_FAILED');
    }
  }
}
