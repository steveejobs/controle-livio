import { expect, test } from '@playwright/test';

for (const width of [360, 1440]) {
  test(`office settings, signature revocation and document versions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const settings = {
      attorneyName: 'Profissional QA',
      professionalRegistration: 'OAB/QA 123',
      officeAddress: 'Rua Sintética, 123',
      jurisdiction: 'Cidade QA',
      paymentInstructions: '',
    };
    const documentRecord = {
      id: 'document-qa',
      title: 'Documento QA',
      visibility: 'INTERNAL',
      updatedAt: '2026-11-01',
      versions: [
        {
          id: 'version-1',
          fileName: 'original.pdf',
          mimeType: 'application/pdf',
          version: 1,
          createdAt: '2026-11-01',
        },
      ],
      signingRequests: [
        { id: 'signature-qa', signerName: 'Pessoa QA', status: 'PENDING', expiresAt: '2026-11-20' },
      ],
    };
    let revocations = 0,
      versions = 0;
    const saved: Record<string, unknown>[] = [];
    await page.route('**/v1/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let status = 200,
        body: unknown;
      if (path === '/v1/auth/me')
        body = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            isAdministrator: true,
            permissions: ['documents:view', 'documents:update', 'organization:update'],
          },
          organization: { name: 'QA' },
        };
      else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
      else if (path === '/v1/documents') body = { items: [documentRecord], total: 1 };
      else if (path === '/v1/documents/templates') body = { templates: [], variables: [] };
      else if (path === '/v1/documents/office-settings') {
        if (request.method() === 'PATCH') {
          const input = request.postDataJSON() as Record<string, unknown>;
          saved.push(input);
          Object.assign(settings, input);
        }
        body = { settings };
      } else if (path === '/v1/documents/signature-requests/signature-qa/revoke') {
        if (++revocations === 1) {
          status = 503;
          body = { message: 'Revogação temporariamente indisponível' };
        } else {
          documentRecord.signingRequests[0]!.status = 'REVOKED';
          body = { revoked: true };
        }
      } else if (path === '/v1/documents/document-qa/versions') {
        versions++;
        expect(request.headers()['content-type']).toContain('multipart/form-data');
        expect(request.postDataBuffer()?.toString('latin1')).toContain('nova-versao.png');
        documentRecord.versions = [
          {
            id: 'version-2',
            fileName: 'nova-versao.png',
            mimeType: 'image/png',
            version: 2,
            createdAt: '2026-11-01',
          },
        ];
        body = documentRecord.versions[0];
      } else throw new Error(`Unexpected ${path}`);
      await route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/');
    await page.getByText('Dados do escritório nos documentos', { exact: true }).click();
    await page.getByLabel('Nome profissional').fill('Advogada QA');
    await page.getByLabel('Inscrições na OAB').fill('OAB/QA 456');
    await page.getByLabel('Endereço profissional').fill('Rua de Homologação, 456');
    await page.getByLabel('Foro', { exact: true }).fill('Foro QA');
    await page.getByLabel('Instruções de pagamento').fill('Pagamento sintético QA');
    await page.getByRole('button', { name: 'Salvar dados do escritório' }).click();
    await expect(
      page.getByText('Dados do escritório salvos para as próximas emissões.', { exact: true }),
    ).toBeVisible();
    expect(saved[0]).toMatchObject({
      attorneyName: 'Advogada QA',
      professionalRegistration: 'OAB/QA 456',
      jurisdiction: 'Foro QA',
      paymentInstructions: 'Pagamento sintético QA',
    });
    await page.getByRole('button', { name: 'Cancelar link', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Revogação temporariamente indisponível' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar link', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar link', exact: true }).click();
    await expect(page.getByText('Link de assinatura cancelado.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar link', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Nova versão', exact: true }).click();
    const input = page.getByLabel('Nova versão de Documento QA');
    await input.setInputFiles({
      name: 'grande.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
    });
    await expect(
      page.getByRole('alert').filter({ hasText: 'excede o limite de 4 MiB' }),
    ).toBeVisible();
    await expect(input).toHaveValue('');
    expect(versions).toBe(0);
    await input.setInputFiles({
      name: 'nova-versao.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByText('Nova versão adicionada.', { exact: true })).toBeVisible();
    await expect(page.getByText('nova-versao.png', { exact: true })).toBeVisible();
    expect(versions).toBe(1);
    expect(revocations).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
