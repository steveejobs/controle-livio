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
    process.send({
      pid: process.pid,
      results,
      snapshot: JSON.parse(
        JSON.stringify(await snapshot(r, organizationId), (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ),
    });
  } catch (error) {
    process.send({ error: { name: error.name, code: error.code ?? null } });
  } finally {
    await r?.db.$disconnect();
    finished = true;
    process.disconnect();
  }
});
