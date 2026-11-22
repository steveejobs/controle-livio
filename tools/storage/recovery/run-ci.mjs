import { coordinatedRestore } from './coordinated-restore.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { withFinancialApi } from '../../qa/run-financial-integrity-ci.mjs';
import { recoveryRunnerEnvironment } from './environment.mjs';
import { runFinancialIntegrity } from '../../qa/financial-integrity-ci.mjs';

async function main() {
  const env = {
    ...recoveryRunnerEnvironment(),
    CRON_SECRET: randomBytes(32).toString('hex'),
    LIVIO_RECOVERY_COORDINATED_RESTORE: 'parent-owned',
  };
  const output = resolve(env.LIVIO_QA_OUTPUT);
  mkdirSync(output, { recursive: true });
  // Reuse owned-child readiness, sanitized logs and TERM/KILL cleanup. No scheduler
  // or cloud setting is changed; flags belong only to this disposable process.
  let primary;
  try {
    await withFinancialApi({ api: env, output }, process.cwd(), async () => {
      await runFinancialIntegrity({ ...env, LIVIO_FINANCIAL_INTEGRATION: 'disposable' });
      await new Promise((done, reject) => {
        const child = spawn(process.execPath, [resolve('tools/storage/recovery/integrated.mjs')], {
          env,
          cwd: process.cwd(),
          stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? done() : reject(new Error('Recovery matrix incomplete or failed')),
        );
      });
    });
  } catch (error) {
    primary = error;
  }
  let restore;
  try {
    restore = await coordinatedRestore(env);
  } catch (error) {
    primary ??= error;
  }

  const matrixPath = resolve(output, 'storage-recovery-stage61.json'),
    report = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const row = report.cases.find((c) => c.id === 'REC-X18');
  row.result = restore?.result ?? 'FAIL';
  row.evidence = 'coordinated-restore.json';
  row.observedState = restore?.after ?? null;
  row.observedPhysicalEffect = restore?.backup?.objects ?? null;
  writeFileSync(
    matrixPath,
    JSON.stringify(
      report,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ) + '\n',
  );
  if (primary || report.cases.some((c) => c.result !== 'PASS'))
    throw new Error('Recovery matrix incomplete or failed');
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'DISPOSABLE_RECOVERY_REHEARSAL_FAILED',
      name: error.name,
      code: error.code ?? null,
    }),
  );
  process.exitCode = 1;
});
