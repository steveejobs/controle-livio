import assert from 'node:assert/strict';
import {
  ordinaryStorageSession,
  restrictiveBucketBoundary,
  sanitizeProviderPayload,
} from './storage-authorization-proof.mjs';
import { storageDenial } from './document-storage-matrix.mjs';

// Preserve the original HTTP error body before the SDK reduces it to an Error.
// Never retain request headers, bodies, signed URLs or successful Auth responses.
export function observedStorageFetch(baseFetch = fetch) {
  const observations = [];
  return {
    observations,
    fetch: async (input, init) => {
      const response = await baseFetch(input, init);
      const url = new URL(typeof input === 'string' ? input : (input.url ?? input.href));
      if (url.pathname.startsWith('/storage/v1/object/') && !response.ok) {
        let body = null;
        try {
          body = sanitizeProviderPayload(await response.clone().json());
        } catch {
          /* incomplete evidence remains inconclusive */
        }
        observations.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          http: response.status,
          body,
        });
      }
      return response;
    },
  };
}

export function sdkDenialProven(observation, proof) {
  return (
    observation?.method === 'POST' &&
    observation.path === proof.path &&
    storageDenial(observation.http, observation.body) === 'AUTHORIZATION_DENIED' &&
    proof.jwtValidated === true &&
    proof.exists === true &&
    proof.unchanged === true &&
    proof.positiveControl === true &&
    proof.writeBarrier === true
  );
}

// Caller already enforces disposable Linux/loopback guards. Only read catalog
// and set transaction-local role/claims; no policy, grant or metadata mutations.
export async function sdkWriteBarrier(db, profileId, organizationId) {
  assert.match(profileId, /^[0-9a-f-]{36}$/i);
  const membership = await db.organizationMember.findFirstOrThrow({
    where: { profileId, organizationId, status: 'ACTIVE' },
  });
  assert.equal(membership.organizationId, organizationId);
  const policies = await db.$queryRawUnsafe(
    "SELECT policyname,permissive,roles::text AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects'",
  );
  const session = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');
    await tx.$queryRawUnsafe(
      "SELECT set_config('request.jwt.claims',$1,true)",
      JSON.stringify({ role: 'authenticated', sub: profileId }),
    );
    return (
      await tx.$queryRawUnsafe(
        "SELECT current_user::text AS role,auth.uid()::text AS profile_id,r.rolsuper,r.rolbypassrls,c.relrowsecurity,(pg_has_role(current_user,c.relowner,'USAGE') OR pg_has_role(current_user,c.relowner,'SET')) AS owns_table,EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls) AND pg_has_role(current_user,p.oid,'SET')) AS can_assume_privileged FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='storage.objects'::regclass",
      )
    )[0];
  });
  return {
    session,
    policies,
    organizationId,
    profileId,
    writeBarrier:
      ordinaryStorageSession(session, { profileId }) &&
      restrictiveBucketBoundary(policies, 'authenticated', 'insert') &&
      restrictiveBucketBoundary(policies, 'authenticated', 'update'),
  };
}
