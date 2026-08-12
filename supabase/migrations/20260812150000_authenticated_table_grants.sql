BEGIN;

-- PostgreSQL privileges are the outer gate; RLS remains the per-row authorization gate.
-- Deliberately exclude TRUNCATE, REFERENCES and TRIGGER from the application role.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

COMMIT;
