import { expect, test, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { createWorker as createOcrWorker } from 'tesseract.js';
import { openClientQualification } from './support/client-qualification';
import { identityOcrFixture, identityOcrGroundTruth } from './support/identity-ocr-fixture';
import { observeSyntheticOcr, syntheticOcrObservations } from './support/ocr-evidence';
import { parseIdentificationText } from '../features/clients/identification-reader';

test('stage56 optical fixture uses real browser Tesseract without persistence claims', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const png = identityOcrFixture();
  await page.goto('/');
  await page.addScriptTag({ path: resolve('node_modules/tesseract.js/dist/tesseract.min.js') });
  const result = await page.evaluate(async (encoded) => {
    const tesseract = (window as unknown as { Tesseract: { createWorker: typeof createOcrWorker } })
      .Tesseract;
    const worker = await tesseract.createWorker('por', 1, {
      workerPath: '/ocr/worker.min.js',
      langPath: '/ocr',
      corePath: '/ocr/tesseract-core.wasm.js',
    });
    try {
      const { data } = await worker.recognize('data:image/png;base64,' + encoded);
      return { text: data.text, confidence: data.confidence };
    } finally {
      await worker.terminate();
    }
  }, png.toString('base64'));
  const evidence = {
    scope: 'REAL_BROWSER_TESSERACT_PARSER_ONLY_NO_API_OR_POSTGRESQL',
    browser: page.context().browser()?.version(),
    node: process.version,
    width: 1600,
    height: 1000,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    expected: identityOcrGroundTruth,
    ...result,
    parsed: parseIdentificationText(result.text),
  };
  mkdirSync('test-results/ocr-stage56', { recursive: true });
  writeFileSync('test-results/ocr-stage56/optical.json', JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync('test-results/ocr-stage56/input.png', png);
  await info.attach('stage56-real-optical-evidence', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  expect(evidence.parsed).toEqual(identityOcrGroundTruth);
});

async function image(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1000;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1600, 1000);
      ctx.fillStyle = '#111';
      ctx.font = '32px Arial';
      ctx.fillText('TESTE SINTETICO - SEM VALIDADE', 50, 55);
      ctx.font = '48px Arial';
      [
        'NOME: PESSOA SINTETICA ARAUJO',
        'CPF: 529.982.247-25',
        'RG: 1234567',
        'SSP/MA',
        'NASCIMENTO: 24/05/1990',
      ].forEach((line, i) => ctx.fillText(line, 55, 160 + i * 120));
      return canvas.toDataURL('image/png').split(',')[1]!;
    }),
    'base64',
  );
}

for (const width of [360, 390, 768, 1440]) {
  test(`identity review and reopening with simulated API at ${width}px`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await observeSyntheticOcr(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> =
      [];
    let client: Record<string, unknown> | undefined;
    const unexpected: string[] = [];
    const externalHosts = new Set<string>();
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !['127.0.0.1', 'localhost'].includes(url.hostname)
      ) {
        externalHosts.add(url.hostname);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/v1/**', async (route) => {
      const r = route.request();
      const path = new URL(r.url()).pathname;
      const method = r.method();
      const body = r.headers()['content-type']?.includes('application/json')
        ? r.postDataJSON()
        : null;
      let result: unknown;
      if (path === '/v1/auth/me')
        result = {
          user: {
            id: 'synthetic-user',
            email: 'test@example.invalid',
            permissions: [
              'clients:view',
              'clients:create',
              'clients:update',
              'documents:view',
              'documents:create',
            ],
          },
          organization: { name: 'Synthetic QA' },
        };
      else if (path.startsWith('/v1/audit-logs/')) result = { recorded: true };
      else if (path === '/v1/dashboard/summary')
        result = {
          activeClients: 0,
          activeMatters: 0,
          overdueReceivables: 0,
          openTasks: 0,
          monthlyReceivables: [],
        };
      else if (path === '/v1/clients' && method === 'GET')
        result = { items: client ? [client] : [], total: client ? 1 : 0 };
      else if (path === '/v1/clients' && method === 'POST') {
        client = {
          id: 'synthetic-client',
          ...body,
          updatedAt: '2026-11-10T12:00:00.000Z',
          taxIdNormalized: String(body.taxId).replace(/\D/g, ''),
        };
        result = client;
      } else if (path === '/v1/clients/synthetic-client/overview')
        result = {
          client,
          contacts: [],
          matters: [],
          contracts: [],
          financial: { receivables: [], payments: [], outstanding: [] },
          documents: [],
          internalNotes: [],
          clientMessages: [],
        };
      else if (path === '/v1/clients/synthetic-client' && method === 'PATCH') {
        Object.assign(client!, body);
        result = client;
      } else {
        unexpected.push(method + ' ' + path);
        result = { message: 'Unexpected test request' };
      }
      requests.push({ method, path, body: body ? structuredClone(body) : null });
      await route.fulfill({
        status: unexpected.length ? 500 : 200,
        contentType: 'application/json',
        body: JSON.stringify(result),
      });
    });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Abrir navegação' });
    if (width < 1000) {
      await expect(menu).toBeVisible();
      await menu.click();
    }
    await page
      .getByRole('navigation', { name: /Navega.*principal/ })
      .getByRole('button', { name: 'Clientes' })
      .click({ timeout: 10000 });
    await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Cadastrar e abrir cliente' }) });
    // The UI must reject the same >4 MiB input as the document API before OCR/upload.
    await form.getByLabel('Escolher foto do documento').setInputFiles({
      name: 'oversize.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
    });
    await expect(form.getByRole('alert')).toContainText('4 MiB');
    await form.getByLabel('Escolher foto do documento').setInputFiles({
      name: 'synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 SYNTHETIC INVALID'),
    });
    await expect(form.getByRole('alert')).toContainText('JPG ou PNG');
    const png = await image(page);
    let releaseLanguage: () => void = () => undefined;
    let languageRequested = false;
    const languageGate = new Promise<void>((resolve) => {
      releaseLanguage = resolve;
    });
    const holdLanguage = async (route: Route) => {
      languageRequested = true;
      await languageGate;
      await route.continue();
    };
    await page.route('**/ocr/por.traineddata.gz', holdLanguage);
    try {
      await form
        .getByLabel('Escolher foto do documento')
        .setInputFiles({ name: 'cancelled-synthetic.png', mimeType: 'image/png', buffer: png });
      await form.getByRole('button', { name: 'Ler dados do documento' }).click();
      await expect.poll(() => languageRequested).toBe(true);
      await form
        .getByRole('button', { name: 'Descartar imagem e leitura' })
        .click({ timeout: 10000 });
    } finally {
      releaseLanguage();
      await page.unroute('**/ocr/por.traineddata.gz', holdLanguage);
    }
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue('');
    await expect(form.getByRole('img', { name: 'Prévia do documento selecionado' })).toHaveCount(0);
    await form.getByLabel('Escolher foto do documento').setInputFiles({
      name: 'corrupt.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    await expect(form.getByRole('alert')).toContainText('Não foi possível ler a imagem', {
      timeout: 30000,
    });
    await form
      .getByLabel('Escolher foto do documento')
      .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    await form.getByRole('button', { name: 'Ler dados do documento' }).click();
    await expect(form.getByLabel('Escolher foto do documento')).toBeDisabled();
    await expect(form.getByLabel('Nome encontrado')).toHaveValue('PESSOA SINTETICA ARAUJO', {
      timeout: 120_000,
    });
    const ocrTrace = await syntheticOcrObservations(page);
    expect(ocrTrace.length).toBeGreaterThan(0);
    expect(parseIdentificationText(ocrTrace.at(-1)!.text).cpf).toBe('52998224725');
    await form.getByLabel('Nome completo', { exact: true }).fill('VALOR ATUAL SINTETICO');
    await form.getByLabel('CPF', { exact: true }).fill('11144477735');
    await expect(form.locator('input[name="legalIdentity.birthDate"]')).not.toBeVisible();
    await openClientQualification(form);
    await form.getByLabel('RG e órgão expedidor', { exact: true }).fill('ATUAL-123');
    await form.locator('input[name="legalIdentity.birthDate"]').fill('1980-01-01');
    const conflicts: string[] = [];
    page.on('dialog', async (dialog) => {
      conflicts.push(dialog.message());
      await dialog.dismiss();
    });
    await form.getByRole('button', { name: 'Usar dados no cadastro' }).click();
    expect(conflicts).toHaveLength(4);
    await expect(
      form.getByText(/Valores atuais preservados. Nenhum dado foi substituído/),
    ).toBeVisible();
    for (const label of ['Nome:', 'CPF:', 'RG e órgão expedidor:', 'Data de nascimento:'])
      expect(conflicts.some((x) => x.startsWith(label))).toBe(true);
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue(
      'VALOR ATUAL SINTETICO',
    );
    await expect(form.getByLabel('CPF', { exact: true })).toHaveValue('111.444.777-35');
    await expect(form.getByLabel('RG e órgão expedidor', { exact: true })).toHaveValue('ATUAL-123');
    await expect(form.locator('input[name="legalIdentity.birthDate"]')).toHaveValue('1980-01-01');
    page.removeAllListeners('dialog');
    await form.getByRole('button', { name: 'Rever dados extraídos' }).click();
    await form.getByLabel('Nome encontrado').fill('');
    await expect(form.getByLabel('Nome encontrado')).toBeVisible();
    await form.getByLabel('Nome encontrado').fill('REVISAO MANUAL SINTETICA');
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await form.getByRole('button', { name: 'Usar dados no cadastro' }).click();
    await expect(form.getByLabel('Nome completo', { exact: true })).toHaveValue(
      'REVISAO MANUAL SINTETICA',
    );
    // Explicitly discard only the attachment/reading; already approved form fields remain.
    await form.getByRole('button', { name: 'Descartar imagem e leitura' }).click();
    await expect(form.getByRole('img', { name: 'Prévia do documento selecionado' })).toHaveCount(0);
    await expect(form.getByLabel('CPF', { exact: true })).toHaveValue('529.982.247-25');
    await form.getByLabel('E-mail', { exact: true }).fill('approved@example.invalid');
    await form.getByLabel('Telefone', { exact: true }).fill('123456');
    await form.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    await expect(
      page.getByRole('heading', { name: 'REVISAO MANUAL SINTETICA', exact: true }),
    ).toBeVisible();
    const posted = requests.find((r) => r.path === '/v1/clients' && r.method === 'POST')!.body!;
    expect(posted.customFields).toMatchObject({
      legalIdentity: { identityDocument: '1234567 · SSP/MA', birthDate: '1990-05-24' },
    });
    expect(requests.some((r) => r.method === 'POST' && r.path === '/v1/documents')).toBe(false);
    const custom = client!.customFields as { legalIdentity: Record<string, unknown> };
    custom.legalIdentity.externalRegistration = 'PRESERVE_SYNTHETIC_EXTENSION';
    await page.reload();
    const reopenedMenu = page.getByRole('button', { name: 'Abrir navegação' });
    if (width < 1000) {
      await expect(reopenedMenu).toBeVisible();
      await reopenedMenu.click();
    }
    await page
      .getByRole('navigation', { name: /Navega.*principal/ })
      .getByRole('button', { name: 'Clientes' })
      .click({ timeout: 10000 });
    await page
      .getByRole('row')
      .filter({ hasText: 'REVISAO MANUAL SINTETICA' })
      .getByRole('button', { name: 'Abrir', exact: true })
      .click();
    await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(
      'REVISAO MANUAL SINTETICA',
    );
    await page.getByText('Qualificação para documentos', { exact: true }).click();
    await expect(page.getByLabel('Data de nascimento', { exact: true })).toHaveValue('1990-05-24');
    await expect(page.getByLabel('RG e órgão expedidor', { exact: true })).toHaveValue(
      '1234567 · SSP/MA',
    );
    await page.locator('#dados-cliente form').getByLabel('E-mail', { exact: true }).fill('');
    await page.locator('#dados-cliente form').getByLabel('Telefone', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect.poll(() => requests.filter((r) => r.method === 'PATCH').length).toBe(1);
    const patched = requests.find((r) => r.method === 'PATCH')!.body!;
    expect(patched).toMatchObject({
      email: '',
      phone: '',
      expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
      customFields: { legalIdentity: { externalRegistration: 'PRESERVE_SYNTHETIC_EXTENSION' } },
    });
    await page.getByLabel('Nome completo', { exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(unexpected).toEqual([]);
    expect([...externalHosts]).toEqual([]);
    expect(pageErrors).toEqual([]);
    await info.attach('identity-mock-scope', {
      body: JSON.stringify({
        width,
        sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        node: process.version,
        browserVersion: page.context().browser()?.version(),
        scope: 'real browser + real OCR + simulated API persistence, no PostgreSQL',
        rawOcr: ocrTrace,
        posted,
      }),
      contentType: 'application/json',
    });
    await info.attach('identity-ui-screenshot', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
