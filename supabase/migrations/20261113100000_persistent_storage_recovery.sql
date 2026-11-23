-- Expansion only. No scheduler, worker, destructive sweep or hosted activation.
-- Existing DEF-008/017/018 policies, grants and functions are not replaced.
BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('public.document_versions') IS NULL
    OR to_regclass('public.document_signing_requests') IS NULL THEN
    RAISE EXCEPTION 'Recovery requires the complete document baseline';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Browser roles must not bypass RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles client CROSS JOIN pg_roles privileged
    WHERE client.rolname IN ('anon','authenticated') AND (privileged.rolsuper OR privileged.rolbypassrls)
      AND pg_has_role(client.oid,privileged.oid,'MEMBER')) THEN
    RAISE EXCEPTION 'Browser roles must not reach privileged memberships';
  END IF;
  IF to_regclass('public.storage_upload_intents') IS NOT NULL THEN
    RAISE EXCEPTION 'Review conflicting recovery schema before expansion';
  END IF;
END $preflight$;

CREATE TABLE public.storage_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  purpose varchar(24) NOT NULL CHECK (purpose IN ('DOCUMENT','VERSION','PHOTO','SIGNATURE','SIGNED_PDF')),
  bucket varchar(63) NOT NULL CHECK (bucket IN ('legal-documents','client-photos','document-signatures')),
  object_key text NOT NULL,
  resource_type varchar(32) NOT NULL CHECK (resource_type IN ('document','client','document_signing_request')),
  resource_id uuid NOT NULL,
  group_id uuid,
  expected_sha256 char(64) CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  observed_sha256 char(64) CHECK (observed_sha256 ~ '^[a-f0-9]{64}$'),
  state varchar(32) NOT NULL DEFAULT 'PLANNED' CHECK (state IN (
    'PLANNED','UPLOADING','OBJECT_CREATED','ATTACHED','COMPLETE','COMPENSATION_REQUIRED',
    'RECONCILE_PENDING','DELETING','ABSENT','RETAINED','INCIDENT')),
  CHECK (state NOT IN ('UPLOADING','OBJECT_CREATED','ATTACHED','COMPLETE') OR expected_sha256 IS NOT NULL),
  idempotency_key varchar(160) NOT NULL,
  owner_token uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_error_code varchar(80),
  legal_hold boolean NOT NULL DEFAULT false,
  abandoned_at timestamptz(3),
  cleanup_started_at timestamptz(3),
  lease_until timestamptz(3) NOT NULL,
  due_at timestamptz(3) NOT NULL,
  last_checked_at timestamptz(3),
  attached_at timestamptz(3),
  completed_at timestamptz(3),
  actor_user_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id), UNIQUE (bucket, object_key), UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CHECK ((purpose IN ('DOCUMENT','VERSION','SIGNED_PDF') AND bucket='legal-documents' AND resource_type='document')
    OR (purpose='PHOTO' AND bucket='client-photos' AND resource_type='client')
    OR (purpose='SIGNATURE' AND bucket='document-signatures' AND resource_type='document_signing_request')),
  CHECK (object_key !~ '(^|/)\.{1,2}(/|$)' AND object_key NOT LIKE '%//%' AND object_key !~ '[[:cntrl:]]' AND position(chr(92) in object_key)=0 AND
    ((bucket='client-photos' AND object_key LIKE organization_id::text || '/clients/%') OR
     (bucket IN ('legal-documents','document-signatures') AND object_key LIKE 'organizations/' || organization_id::text || '/%')))
);
CREATE INDEX storage_upload_intents_state_due_idx ON public.storage_upload_intents(state,due_at);
CREATE INDEX storage_upload_intents_org_created_idx ON public.storage_upload_intents(organization_id,created_at);
CREATE INDEX storage_upload_intents_group_idx ON public.storage_upload_intents(group_id);
CREATE TABLE public.storage_recovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  from_state varchar(32), to_state varchar(32) NOT NULL,
  reason varchar(80) NOT NULL,
  attempt integer NOT NULL, generation integer NOT NULL,
  actor_user_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id,organization_id) REFERENCES public.storage_upload_intents(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX storage_recovery_events_org_operation_idx ON public.storage_recovery_events(organization_id,operation_id,created_at);
CREATE TABLE public.storage_recovery_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  operation_id uuid,
  fingerprint char(64) NOT NULL,
  kind varchar(80) NOT NULL,
  bucket varchar(63) NOT NULL,
  object_key text NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED')),
  notification_undelivered boolean NOT NULL DEFAULT false,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE RESTRICT,
  resolution varchar(20) CHECK (resolution IN ('RETRY','RETAIN')),
  resolution_reason varchar(1000), resolved_by_id uuid, resolved_at timestamptz(3),
  first_observed_at timestamptz(3) NOT NULL DEFAULT now(),
  last_observed_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (organization_id,fingerprint),
  FOREIGN KEY (operation_id,organization_id) REFERENCES public.storage_upload_intents(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (resolved_by_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CHECK (state <> 'RESOLVED' OR (resolution IS NOT NULL AND resolved_by_id IS NOT NULL AND resolved_at IS NOT NULL AND length(resolution_reason)>=12))
);
CREATE INDEX storage_recovery_incidents_org_state_idx ON public.storage_recovery_incidents(organization_id,state,last_observed_at);
CREATE TABLE public.storage_recovery_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  require_managed_references boolean NOT NULL DEFAULT false
);
INSERT INTO public.storage_recovery_configuration(singleton,require_managed_references) VALUES (true,false);
ALTER TABLE public.document_signing_requests
  ADD COLUMN processing_group_id uuid,
  ADD COLUMN processing_lease_until timestamptz(3);

DO $security$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['storage_upload_intents','storage_recovery_events','storage_recovery_incidents','storage_recovery_configuration'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  END LOOP;
END $security$;

CREATE FUNCTION public.storage_recovery_intent_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE allowed text[];
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery history is retained' USING ERRCODE='23514'; END IF;
  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id=NEW.actor_user_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Foreign recovery owner' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PLANNED' OR NEW.attempts<>0 OR NEW.generation<>0 THEN
      RAISE EXCEPTION 'Intent must start planned' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.organization_id,NEW.bucket,NEW.object_key,NEW.purpose,NEW.resource_type,NEW.resource_id,NEW.group_id,NEW.idempotency_key,NEW.actor_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.bucket,OLD.object_key,OLD.purpose,OLD.resource_type,OLD.resource_id,OLD.group_id,OLD.idempotency_key,OLD.actor_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Recovery identity is immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.expected_sha256 IS NOT NULL AND NEW.expected_sha256 IS DISTINCT FROM OLD.expected_sha256)
    OR (OLD.legal_hold AND NOT NEW.legal_hold)
    OR (OLD.abandoned_at IS NOT NULL AND NEW.abandoned_at IS DISTINCT FROM OLD.abandoned_at)
    OR (OLD.cleanup_started_at IS NOT NULL AND NEW.cleanup_started_at IS NULL) THEN
    RAISE EXCEPTION 'Recovery proof and retention cannot be erased' USING ERRCODE='23514';
  END IF;
  IF OLD.expected_sha256 IS NULL AND NEW.expected_sha256 IS NOT NULL AND OLD.state<>'PLANNED' THEN
    RAISE EXCEPTION 'Hash must be fixed before upload' USING ERRCODE='23514';
  END IF;
  IF NEW.generation IS DISTINCT FROM OLD.generation THEN
    IF NEW.generation<>OLD.generation+1 OR OLD.state<>'INCIDENT' OR NEW.state<>'RECONCILE_PENDING' OR NEW.attempts<>0
      OR NEW.last_error_code IS DISTINCT FROM 'MANUAL_RETRY_AUTHORIZED'
      OR NEW.legal_hold OR (OLD.attached_at IS NOT NULL AND OLD.cleanup_started_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.document_versions WHERE storage_key=NEW.object_key)
      OR EXISTS(SELECT 1 FROM public.clients WHERE photo_storage_key=NEW.object_key)
      OR EXISTS(SELECT 1 FROM public.document_signing_requests WHERE signature_storage_key=NEW.object_key)
      OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=nullif(current_setting('livio.recovery_actor',true),'')::uuid AND organization_id=NEW.organization_id) THEN
      RAISE EXCEPTION 'Retry generation requires an identified manual decision' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.attempts<OLD.attempts THEN
    RAISE EXCEPTION 'Recovery attempts cannot be silently reset' USING ERRCODE='23514';
  END IF;
  IF OLD.state='DELETING' AND NOT OLD.legal_hold AND NEW.legal_hold THEN
    RAISE EXCEPTION 'Deletion already fenced; retention requires an integrity review' USING ERRCODE='23514';
  END IF;
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  IF OLD.state='RETAINED' AND NEW.state='RECONCILE_PENDING' AND (NEW.legal_hold OR NEW.cleanup_started_at IS NULL OR NEW.last_error_code IS DISTINCT FROM 'AUTHORIZED_PHOTO_RETIREMENT' OR NEW.purpose<>'PHOTO') THEN
    RAISE EXCEPTION 'Retention requires explicit eligible photo retirement' USING ERRCODE='23514';
  END IF;
  allowed := CASE OLD.state
    WHEN 'PLANNED' THEN ARRAY['UPLOADING','COMPENSATION_REQUIRED','INCIDENT']
    WHEN 'UPLOADING' THEN ARRAY['OBJECT_CREATED','COMPENSATION_REQUIRED','INCIDENT']
    WHEN 'OBJECT_CREATED' THEN ARRAY['ATTACHED','COMPENSATION_REQUIRED','INCIDENT']
    WHEN 'ATTACHED' THEN ARRAY['COMPLETE','INCIDENT']
    WHEN 'COMPLETE' THEN ARRAY['RECONCILE_PENDING','RETAINED','INCIDENT']
    WHEN 'COMPENSATION_REQUIRED' THEN ARRAY['RECONCILE_PENDING','DELETING','RETAINED','ABSENT','INCIDENT']
    WHEN 'RECONCILE_PENDING' THEN ARRAY['DELETING','RETAINED','ABSENT','INCIDENT']
    WHEN 'DELETING' THEN ARRAY['RECONCILE_PENDING','ABSENT','INCIDENT']
    WHEN 'ABSENT' THEN ARRAY['RECONCILE_PENDING','INCIDENT']
    WHEN 'RETAINED' THEN ARRAY['RECONCILE_PENDING','INCIDENT']
    WHEN 'INCIDENT' THEN ARRAY['RECONCILE_PENDING','RETAINED'] ELSE ARRAY[]::text[] END;
  IF NOT NEW.state=ANY(allowed) THEN RAISE EXCEPTION 'Invalid recovery transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.storage_recovery_record_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; previous text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.state=OLD.state AND NEW.attempts=OLD.attempts AND NEW.generation=OLD.generation
    AND NEW.legal_hold=OLD.legal_hold AND NEW.abandoned_at IS NOT DISTINCT FROM OLD.abandoned_at AND NEW.cleanup_started_at IS NOT DISTINCT FROM OLD.cleanup_started_at THEN RETURN NEW; END IF;
  previous := CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.state END;
  actor := nullif(current_setting('livio.recovery_actor',true),'')::uuid;
  INSERT INTO public.storage_recovery_events(organization_id,operation_id,from_state,to_state,reason,attempt,generation,actor_user_id)
    VALUES (NEW.organization_id,NEW.id,previous,NEW.state,
      CASE WHEN TG_OP='UPDATE' AND NEW.legal_hold AND NOT OLD.legal_hold THEN 'LEGAL_HOLD_APPLIED' WHEN TG_OP='UPDATE' AND NEW.abandoned_at IS NOT NULL AND OLD.abandoned_at IS NULL THEN 'UPLOAD_ABANDONED' ELSE coalesce(NEW.last_error_code,NEW.state) END,
      NEW.attempts,NEW.generation,actor);
  INSERT INTO public.audit_logs(id,organization_id,actor_user_id,action,resource,resource_id,"after",metadata)
    VALUES(gen_random_uuid(),NEW.organization_id,actor,'UPDATE','storage_recovery',NEW.id,
      jsonb_build_object('from',previous,'state',NEW.state,'attempt',NEW.attempts,'generation',NEW.generation),
      jsonb_build_object('automated',actor IS NULL,'code',NEW.last_error_code));
  RETURN NEW;
END $$;
CREATE TRIGGER storage_recovery_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.storage_upload_intents
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_intent_guard();
CREATE TRIGGER storage_recovery_record_transition AFTER INSERT OR UPDATE ON public.storage_upload_intents
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_record_transition();

CREATE FUNCTION public.storage_recovery_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Recovery history is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER storage_recovery_events_append_only BEFORE UPDATE OR DELETE ON public.storage_recovery_events
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_append_only();
CREATE TRIGGER storage_recovery_incidents_no_delete BEFORE DELETE ON public.storage_recovery_incidents
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_append_only();

CREATE FUNCTION public.storage_recovery_incident_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.organization_id,NEW.operation_id,NEW.fingerprint,NEW.kind,NEW.bucket,NEW.object_key,NEW.first_observed_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.operation_id,OLD.fingerprint,OLD.kind,OLD.bucket,OLD.object_key,OLD.first_observed_at) THEN
    RAISE EXCEPTION 'Incident identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.resolved_by_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.resolved_by_id AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Foreign incident operator' USING ERRCODE='23514';
  END IF;
  IF NEW.notification_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=NEW.notification_id AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Foreign incident notification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER storage_recovery_incident_guard BEFORE INSERT OR UPDATE ON public.storage_recovery_incidents
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_incident_guard();

-- Same operation row is locked by attachment, retirement, manual resolution and recovery.
-- Legacy keys remain readable; strict admission is a separate, reviewed cutover.
CREATE FUNCTION public.storage_recovery_reference_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE key text; row_data public.storage_upload_intents%ROWTYPE; unchanged boolean := false;
BEGIN
  key := to_jsonb(NEW)->>TG_ARGV[0]; IF key IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN unchanged := ROW(key,NEW.organization_id,to_jsonb(NEW)->>TG_ARGV[3]) IS NOT DISTINCT FROM
    ROW(to_jsonb(OLD)->>TG_ARGV[0],OLD.organization_id,to_jsonb(OLD)->>TG_ARGV[3]); END IF;
  SELECT * INTO row_data FROM public.storage_upload_intents WHERE bucket=TG_ARGV[1] AND object_key=key FOR UPDATE;
  IF NOT FOUND THEN
    IF (SELECT require_managed_references FROM public.storage_recovery_configuration WHERE singleton) AND NOT unchanged THEN
      RAISE EXCEPTION 'Managed upload required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF row_data.organization_id<>NEW.organization_id OR row_data.resource_type<>TG_ARGV[2]
    OR row_data.resource_id<>(to_jsonb(NEW)->>TG_ARGV[3])::uuid OR row_data.cleanup_started_at IS NOT NULL OR row_data.abandoned_at IS NOT NULL
    OR (NOT unchanged AND (row_data.state<>'OBJECT_CREATED' OR row_data.lease_until<=clock_timestamp()))
    OR (unchanged AND row_data.state NOT IN ('OBJECT_CREATED','ATTACHED','COMPLETE','RETAINED'))
    OR row_data.observed_sha256 IS DISTINCT FROM row_data.expected_sha256 OR row_data.expected_sha256 IS NULL THEN
    RAISE EXCEPTION 'Storage attachment fence rejected reference' USING ERRCODE='23514';
  END IF;
  IF TG_ARGV[4]<>'' AND (to_jsonb(NEW)->>TG_ARGV[4]) IS DISTINCT FROM row_data.expected_sha256::text THEN
    RAISE EXCEPTION 'Storage attachment hash mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_document_reference BEFORE INSERT OR UPDATE OF storage_key,organization_id,document_id,sha256 ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_reference_fence('storage_key','legal-documents','document','document_id','sha256');
CREATE TRIGGER recovery_photo_reference BEFORE INSERT OR UPDATE OF photo_storage_key,organization_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_reference_fence('photo_storage_key','client-photos','client','id','');
CREATE TRIGGER recovery_signature_reference BEFORE INSERT OR UPDATE OF signature_storage_key,organization_id,signature_sha256 ON public.document_signing_requests
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_reference_fence('signature_storage_key','document-signatures','document_signing_request','id','signature_sha256');

-- Protect only managed keys; do not replace baseline Storage policies.
-- No row lock here: Storage runs in another transaction while recovery owns the row lock.
CREATE FUNCTION public.storage_recovery_object_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op public.storage_upload_intents%ROWTYPE; b text; k text;
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'last_accessed_at')=(to_jsonb(OLD)-'last_accessed_at') THEN RETURN NEW; END IF;
  b := CASE WHEN TG_OP='DELETE' THEN OLD.bucket_id ELSE NEW.bucket_id END;
  k := CASE WHEN TG_OP='DELETE' THEN OLD.name ELSE NEW.name END;
  IF TG_OP='UPDATE' AND ROW(OLD.bucket_id,OLD.name) IS DISTINCT FROM ROW(NEW.bucket_id,NEW.name)
    AND EXISTS(SELECT 1 FROM public.storage_upload_intents WHERE bucket=OLD.bucket_id AND object_key=OLD.name) THEN
    RAISE EXCEPTION 'Managed object cannot move' USING ERRCODE='42501';
  END IF;
  SELECT * INTO op FROM public.storage_upload_intents WHERE bucket=b AND object_key=k;
  IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server managed object' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN
    IF op.state<>'DELETING' OR op.cleanup_started_at IS NULL OR op.legal_hold OR op.lease_until<=clock_timestamp()
      OR EXISTS(SELECT 1 FROM public.document_versions WHERE storage_key=k)
      OR EXISTS(SELECT 1 FROM public.clients WHERE photo_storage_key=k)
      OR EXISTS(SELECT 1 FROM public.document_signing_requests WHERE signature_storage_key=k) THEN
      RAISE EXCEPTION 'Managed removal not authorized' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Managed bytes are immutable' USING ERRCODE='42501'; END IF;
  IF op.state<>'UPLOADING' OR op.cleanup_started_at IS NOT NULL OR op.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'Upload lease expired' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_managed_storage BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.storage_recovery_object_fence();

REVOKE ALL ON FUNCTION public.storage_recovery_intent_guard(),public.storage_recovery_record_transition(),
  public.storage_recovery_append_only(),public.storage_recovery_reference_fence(),public.storage_recovery_object_fence(),public.storage_recovery_incident_guard()
  FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.permissions(id,organization_id,resource,action,description)
 SELECT gen_random_uuid(),o.id,'storage_recovery',a.action,'Recuperação administrativa de arquivos'
 FROM public.organizations o CROSS JOIN (VALUES ('view'),('manage')) a(action)
 ON CONFLICT(organization_id,resource,action) DO NOTHING;
INSERT INTO public.role_permissions(organization_id,role_id,permission_id)
 SELECT r.organization_id,r.id,p.id FROM public.roles r JOIN public.permissions p
 ON p.organization_id=r.organization_id AND p.resource='storage_recovery' AND p.action IN ('view','manage')
 WHERE r.key='administrator' AND r.is_system ON CONFLICT DO NOTHING;

DO $postcheck$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['storage_upload_intents','storage_recovery_events','storage_recovery_incidents','storage_recovery_configuration'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity AND relforcerowsecurity)
      OR has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Recovery private table boundary incomplete: %',t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('recovery_document_reference','recovery_photo_reference','recovery_signature_reference','recovery_managed_storage') AND tgenabled='O')<>4 THEN
    RAISE EXCEPTION 'Recovery fences incomplete';
  END IF;
END $postcheck$;
COMMIT;
