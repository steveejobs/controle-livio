import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openClientQualification } from '../support/client-qualification';
import { identityOcrFixture, identityOcrGroundTruth } from '../support/identity-ocr-fixture';
import { observeSyntheticOcr, syntheticOcrObservations } from '../support/ocr-evidence';
import { parseIdentificationText } from '../../features/clients/identification-reader';

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

function failureDetails(error: unknown) {
  return {
    name: error instanceof Error ? error.name : 'Unknown',
    message: (error instanceof Error ? error.message : 'Unavailable')
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT_REDACTED]')
      .replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+/g, '[URL_REDACTED]')
      .replace(/(?:Bearer|cookie|authorization|apikey)\s*[:=]?\s*\S+/gi, '[REDACTED]')
      .slice(0, 2000),
  };
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
  const stages = Object.fromEntries(
    [
      'recognition',
      'parser',
      'suggestions',
      'cancel',
      'review',
      'create',
      'postgresql',
      'document',
      'reopen',
      'duplicate',
    ].map((name) => [name, 'NOT_EXECUTED']),
  );
  evidence.stages = stages;
  const checkpoint = (name: string, status = 'FAIL') => {
    stages[name] = status;
    evidence.lastCheckpoint = { name, status };
    mkdirSync(resolve(process.env.LIVIO_QA_OUTPUT!, 'workflow-stages'), { recursive: true });
    writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  };
  const org = '10000000-0000-4000-8000-000000000001';
  const approvedCpf = syntheticCpf(),
    extractedCpf = identityOcrGroundTruth.cpf;
  expect(approvedCpf).not.toBe(extractedCpf);
  const name = 'REVISAO HUMANA SINTETICA ' + randomUUID().slice(0, 8).toUpperCase();
  const png = identityOcrFixture();
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
  evidence.input = {
    width: 1600,
    height: 1000,
    bytes: png.length,
    sha256: hash(png),
    font: '48px Arial; actual platform fallback recorded by optical output',
  };
  evidence.runtime = {
    node: process.version,
    browser: page.context().browser()?.version(),
    assets: ['worker.min.js', 'por.traineddata.gz', 'tesseract-core.wasm.js'].map((file) => ({
      file,
      sha256: hash(readFileSync(resolve('apps/web/public/ocr', file))),
    })),
  };
  await observeSyntheticOcr(page);
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
  let hadPrimaryFailure = false;
  let primaryFailure: unknown;
  let secondaryFailure: unknown;
  try {
    checkpoint('cancel');
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
    checkpoint('cancel', 'PASS');
    await form.getByLabel('CPF', { exact: true }).fill(approvedCpf);
    await openClientQualification(form);
    await form.locator('input[name="legalIdentity.birthDate"]').fill('1980-01-01');
    await form.getByLabel('RG e órgão expedidor', { exact: true }).fill('ATUAL-123');
    await form
      .getByLabel('Escolher foto do documento')
      .setInputFiles({ name: 'synthetic-identity.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    checkpoint('recognition');
    await expect(form.getByLabel('Nome encontrado')).toBeVisible({ timeout: 60000 });
    evidence.rawOcr = await syntheticOcrObservations(page);
    checkpoint('recognition');
    const rawOcr = await syntheticOcrObservations(page);
    expect(rawOcr.length).toBeGreaterThan(0);
    checkpoint('recognition', 'PASS');
    evidence.parsedOcr = parseIdentificationText(rawOcr.at(-1)!.text);
    checkpoint('parser');
    expect(evidence.parsedOcr).toMatchObject(identityOcrGroundTruth);
    checkpoint('parser', 'PASS');
    const cpfFound = form.getByLabel('CPF encontrado');
    evidence.ocrObserved = {
      name: await form.getByLabel('Nome encontrado').inputValue(),
      cpfFieldCount: await cpfFound.count(),
      cpf: (await cpfFound.count()) === 1 ? await cpfFound.inputValue() : null,
      reviewText: await form.getByRole('group', { name: /^Documento de identifica/ }).innerText(),
    };
    checkpoint('suggestions');
    await expect(cpfFound).toHaveValue(extractedCpf);
    checkpoint('suggestions', 'PASS');
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
    checkpoint('review');
    expect(decisions).toContain('CPF:KEEP_CURRENT');
    expect(decisions).toContain('Data de nascimento:KEEP_CURRENT');
    expect(decisions).toContain('RG e órgão expedidor:ACCEPT');
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue(name);
    await expect(form.getByLabel('CPF', { exact: true })).toHaveValue(
      approvedCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
    );
    checkpoint('review', 'PASS');
    const createdResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/clients',
    );
    const uploadedResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/documents',
    );
    await form.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    checkpoint('create');
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    checkpoint('create', 'PASS');
    const body = (await created.json()) as { id: string };
    const uploaded = await uploadedResponse;
    expect(uploaded.status()).toBe(201);
    const row = await db.client.findUniqueOrThrow({ where: { id: body.id } });
    checkpoint('postgresql');
    expect(row.displayName).toBe(name);
    expect(row.taxIdNormalized).toBe(approvedCpf);
    expect(row.customFields).toMatchObject({
      legalIdentity: { birthDate: '1980-01-01', identityDocument: '1234567 · SSP/MA' },
    });
    expect(JSON.stringify(row)).not.toContain(extractedCpf);
    checkpoint('postgresql', 'PASS');
    evidence.persisted = {
      displayName: row.displayName,
      taxIdNormalized: row.taxIdNormalized,
      customFields: row.customFields,
    };
    const document = await db.document.findFirstOrThrow({
      where: { clientId: row.id },
      include: { versions: true },
    });
    checkpoint('document');
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
    checkpoint('document', 'PASS');
    checkpoint('reopen');
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
    // The detail view displays CPF in its identity header; it has no editable CPF field.
    const reopenedIdentity = page.getByRole('heading', { name, exact: true }).locator('..');
    await expect(reopenedIdentity).toHaveCount(1);
    await expect(reopenedIdentity).toBeVisible();
    await expect(reopenedIdentity).toContainText(
      approvedCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
    );
    const reopenedForm = page.locator('#dados-cliente form');
    await openClientQualification(reopenedForm);
    await expect(reopenedForm.getByLabel('RG e órgão expedidor', { exact: true })).toHaveValue(
      '1234567 · SSP/MA',
    );
    await expect(reopenedForm.locator('input[name="legalIdentity.birthDate"]')).toHaveValue(
      '1980-01-01',
    );
    checkpoint('reopen', 'PASS');
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
    const clientsBeforeFailure = await db.client.count({ where: { organizationId: org } });
    const objectsBefore = await db.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'`;
    const duplicateResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/clients',
    );
    await form.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    checkpoint('duplicate');
    expect((await duplicateResponse).status()).toBe(409);
    await expect(form.getByRole('alert')).toBeVisible();
    expect(await db.client.count({ where: { organizationId: org } })).toBe(clientsBeforeFailure);
    expect(await db.document.count({ where: { organizationId: org } })).toBe(beforeFailure);
    expect(
      await db.$queryRaw`SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'`,
    ).toEqual(objectsBefore);
    checkpoint('duplicate', 'PASS');
    evidence.status = 'PASS';
    evidence.clientId = row.id;
    evidence.documentId = document.id;
    evidence.imageSha256 = hash(png);
    evidence.decisions = decisions;
    evidence.rejectedCpfNotPersisted = true;
    evidence.cancelledWithoutCreation = true;
    evidence.duplicateFailedWithoutNewObjects = true;
  } catch (error) {
    hadPrimaryFailure = true;
    primaryFailure = error;
    evidence.error = failureDetails(error);
  } finally {
    const captureErrors: Array<{ stage: string; name: string; message: string }> = [];
    const captureFailure = (stage: string, error: unknown) => {
      secondaryFailure ??= error;
      captureErrors.push({ stage, ...failureDetails(error) });
    };
    // Preserve the real Worker output even if the first suggestion wait fails.
    try {
      const observations = await syntheticOcrObservations(page);
      // A reload starts a new observer. Never discard previously saved observations.
      const previous = Array.isArray(evidence.rawOcr) ? evidence.rawOcr : [];
      const available = [...previous, ...observations];
      evidence.rawOcr = available;
      evidence.parsedOcrObservations = available.map(({ text }) => parseIdentificationText(text));
      evidence.ocrCapture = { status: available.length ? 'PASS' : 'NOT_EXECUTED' };
    } catch (captureError) {
      evidence.ocrCapture = { status: 'FAIL', availability: 'UNAVAILABLE' };
      captureFailure('worker', captureError);
    }
    if (evidence.status !== 'PASS') {
      try {
        const review = page.getByRole('group', { name: /^Documento de identifica/ });
        const count = await review.count();
        evidence.interfaceState = {
          reviewGroupCount: count,
          reviewText: count === 1 ? await review.innerText({ timeout: 2000 }) : null,
          suggestions:
            count === 1
              ? await review.locator('input').evaluateAll((inputs) =>
                  inputs.map((input) => ({
                    id: input.id,
                    value: (input as HTMLInputElement).value,
                  })),
                )
              : [],
          alerts: await page.getByRole('alert').allTextContents(),
        };
      } catch (captureError) {
        captureFailure('interface', captureError);
      }
      try {
        const screenshot = resolve(images, 'identity-ocr-failure-stage57.png');
        await page.screenshot({ path: screenshot, fullPage: true, timeout: 5000 });
        evidence.failureScreenshot = {
          file: screenshot,
          sha256: hash(readFileSync(screenshot)),
        };
      } catch (captureError) {
        captureFailure('screenshot', captureError);
      }
    }
    try {
      await db.$disconnect();
    } catch (captureError) {
      captureFailure('disconnect', captureError);
    }
    evidence.captureErrors = captureErrors;
    if (!hadPrimaryFailure && secondaryFailure) evidence.status = 'FAIL';
    try {
      mkdirSync(resolve(process.env.LIVIO_QA_OUTPUT!, 'workflow-stages'), { recursive: true });
      writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
    } catch (captureError) {
      captureFailure('write', captureError);
      evidence.status = 'FAIL';
      // The controlled synthetic evidence falls back to the CI log if disk writing fails.
      console.error('LIVIO_SYNTHETIC_OCR_CAPTURE_FAILURE ' + JSON.stringify(evidence));
    }
  }
  if (hadPrimaryFailure) throw primaryFailure;
  if (secondaryFailure) throw secondaryFailure;
});
