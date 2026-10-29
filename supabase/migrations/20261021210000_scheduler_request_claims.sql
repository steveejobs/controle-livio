BEGIN;

-- Technical singleton for authenticated, replay-resistant scheduled dispatch. It contains no tenant data.
-- Managed pg_net grants cannot be restricted per project; never put a static credential in its queue.
CREATE TABLE public.scheduled_job_state (
  job_name TEXT PRIMARY KEY,
  last_scheduled_at TIMESTAMPTZ(3) NOT NULL,
  last_completed_at TIMESTAMPTZ(3),
  last_failed_at TIMESTAMPTZ(3)
);
ALTER TABLE public.scheduled_job_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_job_state FORCE ROW LEVEL SECURITY;

COMMIT;
