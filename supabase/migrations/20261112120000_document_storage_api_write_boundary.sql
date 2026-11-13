BEGIN;

-- DEF-017: all legal-documents writes go through the existing server Storage client.
-- Keep SELECT policies, financial guards, other buckets, triggers and grants intact.
DO $preflight$
DECLARE client_role text;
BEGIN
  IF to_regclass('storage.objects') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'storage.objects'::regclass AND relrowsecurity
  ) THEN RAISE EXCEPTION 'Expected Storage objects with RLS enabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'legal-documents' AND NOT public) THEN
    RAISE EXCEPTION 'Expected private legal-documents bucket';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Review existing server Storage role before applying boundary';
  END IF;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class WHERE oid = 'storage.objects'::regclass
      AND (pg_has_role(client_role, relowner, 'SET') OR pg_has_role(client_role, relowner, 'USAGE'))
    ) THEN RAISE EXCEPTION 'Client has Storage object ownership: %', client_role; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE (rolsuper OR rolbypassrls) AND pg_has_role(client_role, oid, 'SET')
    ) THEN RAISE EXCEPTION 'Client can assume privileged role: %', client_role; END IF;
  END LOOP;
END;
$preflight$;

CREATE POLICY document_api_insert_boundary ON storage.objects
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id <> 'legal-documents');
CREATE POLICY document_api_update_boundary ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'legal-documents')
  WITH CHECK (bucket_id <> 'legal-documents');
CREATE POLICY document_api_delete_boundary ON storage.objects
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (bucket_id <> 'legal-documents');

DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
      AND polname IN ('document_api_insert_boundary', 'document_api_update_boundary',
                      'document_api_delete_boundary')
      AND NOT polpermissive AND polcmd IN ('a', 'w', 'd')) <> 3 THEN
    RAISE EXCEPTION 'Document Storage write boundary incomplete';
  END IF;
END;
$postcheck$;

COMMIT;
