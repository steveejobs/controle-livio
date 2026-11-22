import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export async function fixture(r, purpose, options = {}) {
  const { createClient } = require('@supabase/supabase-js'),
    { PDFDocument } = require('pdf-lib'),
    { createCanvas } = require('@napi-rs/canvas');
  const org = await r.db.organization.create({
    data: {
      legalName: 'SYNTHETIC RECOVERY TEST',
      slug: 'recovery-' + randomUUID(),
      status: 'ACTIVE',
    },
  });
  const role = await r.db.role.create({
    data: {
      organizationId: org.id,
      key: 'administrator',
      name: 'Synthetic Administrator',
      isSystem: true,
    },
  });
  const { initialRolePermissions } = require('@livio/shared');
  for (const code of initialRolePermissions.administrator) {
    const [resource, action] = code.split(':');
    const p = await r.db.permission.create({ data: { organizationId: org.id, resource, action } });
    await r.db.rolePermission.create({
      data: { organizationId: org.id, roleId: role.id, permissionId: p.id },
    });
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = 'recovery-' + randomUUID() + '@example.invalid',
    password = 'Synthetic-' + randomUUID() + '!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null);
  const profileId = created.data.user.id;
  await r.db.profile.upsert({
    where: { id: profileId },
    create: { id: profileId, email, fullName: 'SYNTHETIC RECOVERY TEST' },
    update: {},
  });
  const user = await r.db.user.create({
    data: {
      organizationId: org.id,
      authUserId: profileId,
      email,
      fullName: 'SYNTHETIC RECOVERY TEST',
      status: 'ACTIVE',
    },
  });
  const member = await r.db.organizationMember.create({
    data: {
      organizationId: org.id,
      profileId,
      userId: user.id,
      status: 'ACTIVE',
      roles: { create: { organizationId: org.id, roleId: role.id } },
    },
  });
  const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await auth.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null);
  const verified = await auth.auth.getUser(login.data.session.access_token);
  assert.equal(verified.data.user.id, profileId);
  const actor = {
    organizationId: org.id,
    userId: user.id,
    isAdministrator: true,
    permissions: [...initialRolePermissions.administrator],
  };
  const client = await r.clients.create(actor, {
    type: 'PERSON',
    displayName: 'SYNTHETIC RECOVERY TEST',
  });
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('SYNTHETIC RECOVERY TEST - NO LEGAL VALUE');
  const pdfBytes = Buffer.from(await pdf.save());
  const canvas = createCanvas(400, 160),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 400, 160);
  ctx.fillStyle = '#000';
  ctx.font = '24px sans-serif';
  ctx.fillText('SYNTHETIC TEST', 20, 60);
  ctx.beginPath();
  ctx.moveTo(20, 110);
  ctx.lineTo(300, 100);
  ctx.stroke();
  const png = canvas.toBuffer('image/png'),
    file = {
      buffer: pdfBytes,
      size: pdfBytes.length,
      mimetype: 'application/pdf',
      originalname: 'synthetic-recovery.pdf',
    };
  let document, signing;
  if (['VERSION', 'SIGNATURE', 'SIGNED_PDF'].includes(purpose))
    document = await r.docs.create(
      actor,
      { title: 'SYNTHETIC RECOVERY TEST', clientId: client.id, visibility: 'INTERNAL' },
      file,
    );
  if (['SIGNATURE', 'SIGNED_PDF'].includes(purpose))
    signing = await r.signing.createRequest(actor, document.id, {
      signerName: 'SYNTHETIC RECOVERY TEST',
      expiresInDays: 1,
    });
  return {
    ...(options.restoreCredentials ? { restoreCredentials: { email, password, profileId } } : {}),
    actor,
    clientId: client.id,
    documentId: document?.id,
    token: signing?.token,
    signingId: signing?.id,
    purpose,
    bytes: (purpose === 'PHOTO' ? png : pdfBytes).toString('base64'),
    mime: purpose === 'PHOTO' ? 'image/png' : 'application/pdf',
    signature: png.toString('base64'),
    authToken: login.data.session.access_token,
    memberId: member.id,
  };
}

export async function invokeWriter(r, input) {
  const bytes = Buffer.from(input.bytes, 'base64'),
    file = {
      buffer: bytes,
      size: bytes.length,
      mimetype: input.mime,
      originalname: 'synthetic-recovery-test.' + (input.mime === 'image/png' ? 'png' : 'pdf'),
    };
  if (input.purpose === 'DOCUMENT')
    return r.docs.create(
      input.actor,
      { title: 'SYNTHETIC RECOVERY TEST', clientId: input.clientId, visibility: 'INTERNAL' },
      file,
    );
  if (input.purpose === 'VERSION') return r.docs.addVersion(input.actor, input.documentId, file);
  if (input.purpose === 'PHOTO') return r.clients.uploadPhoto(input.actor, input.clientId, file);
  return r.signing.sign(input.token, {
    signerName: 'SYNTHETIC RECOVERY TEST',
    consent: true,
    signature: 'data:image/png;base64,' + input.signature,
  });
}
