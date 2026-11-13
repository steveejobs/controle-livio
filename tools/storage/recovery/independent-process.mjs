import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';

export async function independentRecovery(input, env = process.env) {
  const child = fork(new URL('./recover-child.mjs', import.meta.url), [], {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });
  try {
    child.send({ organizationId: input.actor.organizationId });
    const [message] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('RECOVERY_CHILD_EXITED_WITHOUT_EVIDENCE');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RECOVERY_CHILD_TIMEOUT')), 120000).unref(),
      ),
    ]);
    assert.ok(!message.error, 'Independent recovery failed');
    assert.notEqual(message.pid, process.pid);
    return message;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => {});
    }
  }
}
