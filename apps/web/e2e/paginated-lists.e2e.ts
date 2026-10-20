import { expect, test } from '@playwright/test';

test('processes and documents load the next page without hiding earlier records', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  let matterPageTwoAttempts = 0;
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const headers = { 'access-control-allow-origin': '*' };
    let status = 200;
    let body: unknown;

    if (pathname === '/v1/auth/me') {
      body = {
        user: {
          id: 'paged-admin',
          email: 'qa@example.test',
          permissions: ['matters:view', 'documents:view'],
        },
        organization: { name: 'Organização QA' },
      };
    } else if (pathname === '/v1/matters') {
      if (url.searchParams.has('search')) {
        body = {
          total: 1,
          items: [{ id: 'matter-special', reference: 'P-ESPECIAL', title: 'Processo Especial' }],
        };
      } else {
        if (pageNumber === 2) {
          matterPageTwoAttempts += 1;
          if (matterPageTwoAttempts === 1) status = 503;
        }
        body =
          status === 503
            ? { message: 'Falha temporária' }
            : {
                total: 26,
                items: Array.from({ length: pageNumber === 1 ? 25 : 1 }, (_, index) => {
                  const number = pageNumber === 1 ? index + 1 : 26;
                  return {
                    id: `matter-${number}`,
                    reference: `P-${number}`,
                    title: `Processo ${number}`,
                    status: 'ACTIVE',
                    priority: 'MEDIUM',
                    client: { id: 'client-1', displayName: 'Cliente QA' },
                  };
                }),
              };
      }
    } else if (pathname === '/v1/documents') {
      body = {
        total: 26,
        items: Array.from({ length: pageNumber === 1 ? 25 : 1 }, (_, index) => {
          const number = pageNumber === 1 ? index + 1 : 26;
          return {
            id: `document-${number}`,
            title: `Documento ${number}`,
            visibility: 'INTERNAL',
            updatedAt: '2026-10-20T12:00:00Z',
          };
        }),
      };
    } else {
      throw new Error(`Unexpected API request: ${request.method()} ${pathname}`);
    }

    await route.fulfill({
      status,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Processos' })).toBeVisible();
  await expect(page.getByText('Processo 25')).toBeVisible();
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByRole('alert').getByText('Falha temporária')).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText('Processo 26')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Processo 1', exact: true })).toBeVisible();
  expect(matterPageTwoAttempts).toBe(2);

  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Documentos' }).click();
  await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible();
  await expect(page.getByText('Documento 25')).toBeVisible();
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByText('Documento 26')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Documento 1', exact: true })).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Busca global' });
  await search.fill('Especial');
  await expect(
    page.getByRole('option', { name: 'Processo: P-ESPECIAL - Processo Especial' }),
  ).toBeVisible();
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /-0$/);
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Processos' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
