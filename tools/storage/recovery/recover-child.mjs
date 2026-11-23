import { recoveryEvidence } from './ipc-evidence.mjs';
import { runtime, snapshot } from './runtime.mjs';
let finished = false;
process.once('disconnect', () => {
  if (!finished) process.exit(2);
});
process.once('message', async ({ organizationId }) => {
  let r;
  try {
    r = await runtime();
    await r.recovery.expireSigningRequests();
    const results = await r.recovery.recoverDue();
    process.send(recoveryEvidence(results, await snapshot(r, organizationId)));
  } catch (error) {
    process.send({ error: { name: error.name, code: error.code ?? null } });
  } finally {
    await r?.db.$disconnect();
    finished = true;
    process.disconnect();
  }
});
