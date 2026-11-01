BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- pg_net queues HTTP headers in plaintext until processing. Browser and service roles must not read them.
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA net TO postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres;

-- Jobs and Vault secrets are configured explicitly by tools/notifications/configure-scheduler.mjs.
-- A migration never embeds credentials, enables an unknown endpoint or changes existing jobs.

COMMIT;
