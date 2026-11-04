BEGIN;

-- Browser users have no direct table API in this application. The API applies
-- tenant and permission checks before accessing public tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

-- RLS does not guard these PostgreSQL table privileges.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Future application tables are created by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

COMMIT;
