import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitRestoredProviders(
  env,
  { timeoutMs = 60_000, pollMs = 250, requestTimeoutMs = 2000 } = {},
) {
  const url = new URL(env.SUPABASE_URL);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok(env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
  const started = Date.now();
  const deadline = started + timeoutMs;
  const report = { result: 'FAIL', attempts: 0, elapsedMs: 0, auth: null, storage: null };
  do {
    report.attempts++;
    await Promise.all(
      [
        ['auth', '/auth/v1/health', env.SUPABASE_ANON_KEY],
        ['storage', '/storage/v1/bucket', env.SUPABASE_SERVICE_ROLE_KEY],
      ].map(async ([service, path, key]) => {
        try {
          const response = await fetch(new URL(path, url), {
            headers: { apikey: key, Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          report[service] = response.status;
          await response.body?.cancel();
        } catch {
          report[service] = null;
        }
      }),
    );
    report.elapsedMs = Date.now() - started;
    if (report.auth === 200 && report.storage === 200) {
      report.result = 'PASS';
      return report;
    }
    if (Date.now() < deadline) await delay(Math.min(pollMs, deadline - Date.now()));
  } while (Date.now() < deadline);
  throw Object.assign(new Error('Restored Auth and Storage readiness deadline'), {
    code: 'RESTORED_PROVIDERS_NOT_READY',
    readiness: report,
  });
}
