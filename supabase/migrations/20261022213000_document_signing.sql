BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS documents_organization_id_id_key
  ON public.documents(organization_id, id);

CREATE TABLE public.document_signing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SIGNED', 'EXPIRED', 'REVOKED')),
  signer_name text NOT NULL CHECK (length(trim(signer_name)) BETWEEN 3 AND 200),
  created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expires_at timestamptz(3) NOT NULL,
  viewed_at timestamptz(3),
  signed_at timestamptz(3),
  signature_storage_key text,
  signature_sha256 char(64),
  signed_document_id uuid,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT document_signing_source_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES public.documents(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT document_signing_source_version_fk
    FOREIGN KEY (organization_id, document_id, source_version)
    REFERENCES public.document_versions(organization_id, document_id, version) ON DELETE RESTRICT,
  CONSTRAINT document_signing_signed_document_fk
    FOREIGN KEY (organization_id, signed_document_id)
    REFERENCES public.documents(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT document_signing_evidence_consistent CHECK (
    (status <> 'SIGNED' OR (signed_at IS NOT NULL AND signature_storage_key IS NOT NULL
      AND signature_sha256 IS NOT NULL AND signed_document_id IS NOT NULL))
    AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
  )
);

CREATE INDEX document_signing_document_created_idx
  ON public.document_signing_requests(organization_id, document_id, created_at DESC);
CREATE INDEX document_signing_status_expiry_idx
  ON public.document_signing_requests(organization_id, status, expires_at);

ALTER TABLE public.document_signing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signing_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY document_signing_select ON public.document_signing_requests
  FOR SELECT TO authenticated USING (public.has_permission(organization_id, 'documents', 'view'));
CREATE POLICY document_signing_insert ON public.document_signing_requests
  FOR INSERT TO authenticated WITH CHECK (
    public.has_permission(organization_id, 'documents', 'create')
    AND EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id = document_signing_requests.organization_id
        AND member.profile_id = auth.uid()
        AND member.user_id = document_signing_requests.created_by_id
        AND member.status = 'ACTIVE'
    )
  );
CREATE POLICY document_signing_update ON public.document_signing_requests
  FOR UPDATE TO authenticated
  USING (public.has_permission(organization_id, 'documents', 'update'))
  WITH CHECK (public.has_permission(organization_id, 'documents', 'update'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('document-signatures', 'document-signatures', false, 5242880, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png'];

COMMIT;
