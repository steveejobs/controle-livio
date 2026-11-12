import { test, expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function syntheticCpf() {
  const digits = Array.from(randomUUID().replace(/\D/g, '').padEnd(9, '3').slice(0, 9), Number);
  if (new Set(digits).size === 1) digits[0] = (digits[0]! + 1) % 10;
  for (const count of [9, 10]) {
    const sum = digits.reduce((a, n, i) => a + n * (count + 1 - i), 0);
    const check = (sum * 10) % 11;
    digits.push(check === 10 ? 0 : check);
  }
  return digits.join('');
}

test('identity: real image, Tesseract, field decisions, API, PostgreSQL and reopening', async ({
  page,
}) => {
  test.setTimeout(180000);
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import('./tools/qa/identity-environment.mjs').then(m=>m.validateIdentityEnvironment(process.env,process.cwd()))",
    ],
    {
      env: { ...process.env, LIVIO_IDENTITY_INTEGRATION: 'disposable' },
      windowsHide: true,
      stdio: 'pipe',
      timeout: 30000,
    },
  );
  const db = new PrismaClient();
  const evidence: Record<string, unknown> = {
    status: 'FAIL',
    scope: 'REAL_OCR_BROWSER_API_POSTGRESQL_STORAGE',
    viewport: 1440,
  };
  const out = resolve(process.env.LIVIO_QA_OUTPUT!, 'workflow-stages/identity-ocr-stage52.json');
  const org = '10000000-0000-4000-8000-000000000001';
  const approvedCpf = syntheticCpf(),
    extractedCpf = syntheticCpf();
  expect(approvedCpf).not.toBe(extractedCpf);
  const name = 'REVISAO HUMANA SINTETICA ' + randomUUID().slice(0, 8).toUpperCase();
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = '#111';
  ctx.font = '32px Arial';
  ctx.fillText('TESTE SINTETICO - SEM VALIDADE', 50, 55);
  ctx.font = '48px Arial';
  [
    'NOME: PESSOA SINTETICA ARAUJO',
    'CPF: ' + extractedCpf,
    'RG: 1234567',
    'SSP/MA',
    'NASCIMENTO: 24/05/1990',
  ].forEach((line, i) => ctx.fillText(line, 55, 160 + i * 120));
  const png = canvas.toBuffer('image/png');
  evidence.sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  evidence.syntheticGroundTruth = {
    name: 'PESSOA SINTETICA ARAUJO',
    extractedCpf,
    approvedCpf,
    birthDate: '1990-05-24',
    approvedBirthDate: '1980-01-01',
  };
  const images = resolve(process.env.LIVIO_QA_OUTPUT!, 'screenshots');
  mkdirSync(images, { recursive: true });
  writeFileSync(resolve(images, 'identity-ocr-synthetic-stage52.png'), png, { flag: 'wx' });
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  let creates = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/v1/clients') creates++;
  });
  await page.context().route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(u.protocol) &&
      !['127.0.0.1', 'localhost'].includes(u.hostname)
    ) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  try {
    expect(
      await db.client.count({ where: { organizationId: org, taxIdNormalized: approvedCpf } }),
    ).toBe(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByLabel('E-mail').fill('qa-client-process.aurora@example.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill('LocalOnly-ChangeMe-2026!');
    await page.getByRole('button', { name: 'Entrar no sistema' }).click();
    await page
      .locator('#primary-navigation')
      .getByRole('button', { name: 'Clientes', exact: true })
      .click();
    await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Cadastrar e abrir cliente' }) });
    await form.getByLabel('Nome completo', { exact: true }).fill('VALOR ATUAL SINTETICO');
    const beforeCancel = await db.client.count({ where: { organizationId: org } });
    await form
      .getByLabel('Escolher foto do documento')
      .setInputFiles({ name: 'synthetic-identity.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    await expect(form.getByLabel('Nome encontrado')).toBeVisible({ timeout: 60000 });
    await form.getByRole('button', { name: 'Descartar imagem e leitura' }).click();
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue(
      'VALOR ATUAL SINTETICO',
    );
    expect(creates).toBe(0);
    expect(await db.client.count({ where: { organizationId: org } })).toBe(beforeCancel);
    await form.getByLabel('CPF', { exact: true }).fill(approvedCpf);
    await form.locator('input[name="legalIdentity.birthDate"]').fill('1980-01-01');
    await form.getByLabel('RG e órgão expedidor', { exact: true }).fill('ATUAL-123');
    await form
      .getByLabel('Escolher foto do documento')
      .setInputFiles({ name: 'synthetic-identity.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    await expect(form.getByLabel('Nome encontrado')).toBeVisible({ timeout: 60000 });
    await expect(form.getByLabel('CPF encontrado')).toHaveValue(extractedCpf);
    evidence.ocrObserved = {
      name: await form.getByLabel('Nome encontrado').inputValue(),
      cpf: await form.getByLabel('CPF encontrado').inputValue(),
    };
    await form.getByLabel('Nome encontrado').fill(name);
    const decisions: string[] = [];
    page.on('dialog', async (dialog) => {
      const label = dialog.message().split(':')[0]!;
      const keep = label === 'CPF' || label === 'Data de nascimento';
      decisions.push(label + (keep ? ':KEEP_CURRENT' : ':ACCEPT'));
      if (keep) await dialog.dismiss();
      else await dialog.accept();
    });
    await form.getByRole('button', { name: 'Usar dados no cadastro' }).click();
    expect(decisions).toContain('CPF:KEEP_CURRENT');
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue(name);
    const createdResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/clients',
    );
    const uploadedResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/documents',
    );
    await form.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { id: string };
    const uploaded = await uploadedResponse;
    expect(uploaded.status()).toBe(201);
    const row = await db.client.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.displayName).toBe(name);
    expect(row.taxIdNormalized).toBe(approvedCpf);
    expect(row.customFields).toMatchObject({
      legalIdentity: { birthDate: '1980-01-01', identityDocument: '1234567 · SSP/MA' },
    });
    expect(JSON.stringify(row)).not.toContain(extractedCpf);
    evidence.persisted = {
      displayName: row.displayName,
      taxIdNormalized: row.taxIdNormalized,
      customFields: row.customFields,
    };
    const document = await db.document.findFirstOrThrow({
      where: { clientId: row.id },
      include: { versions: true },
    });
    expect(document.organizationId).toBe(org);
    expect(document.versions).toHaveLength(1);
    expect(document.versions[0]!.sha256).toBe(hash(png));
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const stored = await admin.storage
      .from('legal-documents')
      .download(document.versions[0]!.storageKey);
    expect(stored.error).toBeNull();
    expect(hash(Buffer.from(await stored.data!.arrayBuffer()))).toBe(hash(png));
    await page.reload();
    await page
      .locator('#primary-navigation')
      .getByRole('button', { name: 'Clientes', exact: true })
      .click();
    await page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: 'Abrir', exact: true })
      .click();
    await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(name);
    await expect(page.getByLabel('CPF', { exact: true })).toHaveValue(
      approvedCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
    );
    await page
      .locator('#primary-navigation')
      .getByRole('button', { name: 'Clientes', exact: true })
      .click();
    await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
    await form.getByLabel('Nome completo', { exact: true }).fill(name + ' DUPLICADO');
    await form.getByLabel('CPF', { exact: true }).fill(approvedCpf);
    await form
      .getByLabel('Escolher foto do documento')
      .setInputFiles({ name: 'duplicate-synthetic.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    await expect(form.getByLabel('Nome encontrado')).toBeVisible({ timeout: 60000 });
    await form.getByRole('button', { name: 'Usar dados no cadastro' }).click();
    const beforeFailure = await db.document.count({ where: { organizationId: org } });
    const objectsBefore = await db.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'`;
    const duplicateResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/clients',
    );
    await form.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    expect((await duplicateResponse).status()).toBe(409);
    await expect(form.getByRole('alert')).toBeVisible();
    expect(await db.document.count({ where: { organizationId: org } })).toBe(beforeFailure);
    expect(
      await db.$queryRaw`SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'`,
    ).toEqual(objectsBefore);
    evidence.status = 'PASS';
    evidence.clientId = row.id;
    evidence.documentId = document.id;
    evidence.imageSha256 = hash(png);
    evidence.decisions = decisions;
    evidence.rejectedCpfNotPersisted = true;
    evidence.cancelledWithoutCreation = true;
    evidence.duplicateFailedWithoutNewObjects = true;
  } catch (error) {
    evidence.error = { name: error instanceof Error ? error.name : 'Unknown' };
    throw error;
  } finally {
    mkdirSync(resolve(process.env.LIVIO_QA_OUTPUT!, 'workflow-stages'), { recursive: true });
    writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
    await db.$disconnect();
  }
});
