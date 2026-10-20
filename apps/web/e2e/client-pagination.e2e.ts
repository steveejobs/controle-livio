import { expect, test } from '@playwright/test';

test('clients beyond the first page remain available and search uses the server', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const requestedPages: number[] = [];
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === '/v1/auth/me') {
      body = {
        user: { id: 'client-admin', email: 'qa@example.test', permissions: ['clients:view'] },
        organization: { name: 'Organização QA' },
      };
    } else if (url.pathname === '/v1/clients') {
      const search = url.searchParams.get('search');
      const currentPage = Number(url.searchParams.get('page') ?? '1');
      requestedPages.push(currentPage);
      const numbers = search
        ? [126]
        : currentPage === 1
          ? Array.from({ length: 25 }, (_, i) => i + 1)
          : [26];
      body = {
        total: search ? 1 : 26,
        items: numbers.map((number) => ({
          id: `client-${number}`,
          displayName: `Cliente ${number}`,
          type: 'PERSON',
          updatedAt: '2026-10-20T12:00:00Z',
        })),
      };
    } else {
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cliente 25' })).toBeVisible();
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByRole('cell', { name: 'Cliente 26' })).toBeVisible();
  await expect(page.locator('strong').getByText('Cliente 1', { exact: true })).toBeVisible();
  expect(requestedPages).toContain(2);

  await page.getByRole('textbox', { name: 'Pesquisar clientes' }).fill('Cliente 126');
  await expect(page.getByRole('cell', { name: 'Cliente 126' })).toBeVisible();
  await expect(page.locator('strong').getByText('Cliente 1', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
