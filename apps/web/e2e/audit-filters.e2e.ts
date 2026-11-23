import { expect, test } from '@playwright/test';

for (const width of [360, 1440]) {
  test(`audit categories, actor, date validation and clear filters at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const queries: URLSearchParams[] = [];
    await page.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url());
      let body: unknown;
      if (url.pathname === '/v1/auth/me') {
        body = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            isAdministrator: true,
            permissions: ['audit:view'],
          },
          organization: { name: 'QA' },
        };
      } else if (url.pathname === '/v1/audit-logs/actors') {
        body = {
          items: [{ id: 'qa-actor', fullName: 'Pessoa QA', email: 'person@example.test' }],
          total: 1,
        };
      } else if (url.pathname === '/v1/audit-logs/module-views') {
        body = { recorded: true };
      } else if (url.pathname === '/v1/audit-logs') {
        queries.push(url.searchParams);
        body = {
          items: [
            {
              id: 'event-qa',
              kind: 'CHANGE',
              action: 'VIEW',
              resource: 'audit',
              changedFields: [],
              occurredAt: '2026-11-01T12:00:00Z',
              actorName: 'QA',
              summary: `Categoria ${url.searchParams.get('category')}`,
            },
          ],
          total: 1,
        };
      } else throw new Error(`Unexpected route ${url.pathname}`);
      await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Atividades do sistema' })).toBeVisible();
    for (const category of ['changes', 'access', 'navigation', 'all']) {
      await page.getByLabel('Tipo de atividade').selectOption(category);
      await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
      await expect(page.getByText(`Categoria ${category}`, { exact: true })).toBeVisible();
      expect(queries.some((query) => query.get('category') === category)).toBe(true);
    }
    await page.getByRole('combobox', { name: 'Usuário', exact: true }).selectOption('qa-actor');
    await page.getByLabel('Buscar atividade').fill(' Pessoa QA ');
    await page.getByLabel('De', { exact: true }).fill('2026-11-10');
    await page.getByLabel('Até', { exact: true }).fill('2026-11-01');
    const countBefore = queries.length;
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'A data final deve ser igual ou posterior' }),
    ).toBeVisible();
    expect(queries).toHaveLength(countBefore);
    await page.getByLabel('Até', { exact: true }).fill('2026-11-30');
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('actorUserId')).toBe('qa-actor');
    expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
      search: 'Pessoa QA',
      dateFrom: '2026-11-10',
      dateTo: '2026-11-30',
    });
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(page.getByLabel('Buscar atividade')).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Usuário', exact: true })).toHaveValue('');
    await expect(
      page.getByRole('alert').filter({ hasText: 'A data final deve ser igual ou posterior' }),
    ).toHaveCount(0);
    await expect(page.getByText('Categoria all', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
