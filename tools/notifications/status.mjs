import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

assert.ok(['development', 'test', 'staging'].includes(process.env.SUPABASE_ENVIRONMENT));
assert.equal(process.env.SUPABASE_PROJECT_REF, process.env.CONFIRM_SUPABASE_PROJECT_REF);
const prisma = new PrismaClient();
try {
  const [state, jobs] = await Promise.all([
    prisma.$queryRaw`SELECT job_name, last_scheduled_at, last_completed_at, last_failed_at FROM scheduled_job_state WHERE job_name = 'notifications'`,
    prisma.$queryRaw`SELECT j.jobname, j.active, d.status, d.start_time, d.end_time
      FROM cron.job j LEFT JOIN LATERAL (
        SELECT status, start_time, end_time FROM cron.job_run_details
        WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1
      ) d ON true WHERE j.jobname = 'livio-notifications'`,
  ]);
  console.log(JSON.stringify({ state, jobs }));
} finally {
  await prisma.$disconnect();
}
