import { expect, test } from '@playwright/test';

test('mobile navigation, deferred clients and notification refresh', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });

  const requests = { clients: 0, reconcile: 0 };
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const responseHeaders = { 'access-control-allow-origin': '*' };
    let body: unknown;

    if (pathname === '/v1/auth/me') {
      body = {
        user: {
          id: 'e2e-admin',
          email: 'qa@example.test',
          name: 'QA',
          permissions: [
            'reports:view',
            'matters:view',
            'matters:create',
            'pipelines:view',
            'clients:view',
            'notifications:view',
            'notifications:update',
          ],
        },
        organization: { name: 'Organização QA' },
      };
    } else if (pathname === '/v1/dashboard/summary') {
      body = {
        activeClients: 0,
        activeMatters: 0,
        overdueReceivables: 0,
        openTasks: 0,
        monthlyReceivables: [],
      };
    } else if (pathname === '/v1/matters') {
      body = { items: [], total: 0 };
    } else if (pathname === '/v1/pipelines') {
      body = [];
    } else if (pathname === '/v1/clients') {
      requests.clients += 1;
      body = { items: [], total: 0 };
    } else if (pathname === '/v1/notifications') {
      body = { items: [], unread: 0 };
    } else if (pathname === '/v1/notifications/reconcile' && method === 'POST') {
      requests.reconcile += 1;
      body = { reconciled: 0 };
    } else {
      throw new Error(`Unexpected API request: ${method} ${pathname}`);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: responseHeaders,
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  expect(requests.reconcile).toBe(0);
  expect(requests.clients).toBe(0);

  const menu = page.locator('.menu-button');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.locator('#primary-navigation').getByRole('button', { name: 'Processos' }).click();
  await expect(page.getByRole('heading', { name: 'Processos' })).toBeVisible();
  expect(requests.clients).toBe(0);

  await page.getByRole('button', { name: 'Novo processo' }).click();
  await expect(page.getByRole('button', { name: 'Cadastrar processo' })).toBeVisible();
  await expect.poll(() => requests.clients).toBe(1);

  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Notificações' }).click();
  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
  await expect.poll(() => requests.reconcile).toBe(1);

  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Processos' }).click();
  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Notificações' }).click();
  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
  expect(requests.reconcile).toBe(1);

  await page.getByRole('button', { name: 'Atualizar alertas' }).click();
  await expect.poll(() => requests.reconcile).toBe(2);
  await expect(page.getByRole('button', { name: 'Atualizar alertas' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await menu.click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});
