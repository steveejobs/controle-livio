BEGIN;

CREATE TABLE public.api_rate_limits (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ(3) NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (organization_id, key_hash)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limits FORCE ROW LEVEL SECURITY;
-- Technical counters are accessed only by the API; no browser policy or grant.
-- Each organization/user has at most two counters, reused across time windows.

COMMIT;
