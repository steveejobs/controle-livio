import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const modules = [
  ['Visão geral', 'Visão geral'],
  ['Clientes', 'Clientes'],
  ['Processos', 'Processos'],
  ['CRM comercial', 'CRM comercial'],
  ['CRM jurídico', 'CRM juridico'],
  ['Cobrança', 'CRM de cobranca'],
  ['Documentos', 'Documentos'],
  ['Tarefas', 'Tarefas'],
  ['Agenda', 'Agenda'],
  ['Notificações', 'Notificações'],
  ['Contratos', 'Contratos'],
  ['Recebíveis', 'Entradas, parcelas e pagamentos'],
  ['Relatórios', 'Relatórios'],
  ['Usuários e permissões', 'Advogados e secretaria'],
  ['Pipelines', 'Pipelines'],
  ['Auditoria', 'Logs de auditoria'],
] as const;

const permissions = [
  'reports:view',
  'reports:export',
  'clients:view',
  'clients:create',
  'matters:view',
  'matters:create',
  'matters:update',
  'documents:view',
  'documents:create',
  'tasks:view',
  'tasks:create',
  'calendar:view',
  'calendar:create',
  'notifications:view',
  'notifications:update',
  'contracts:view',
  'contracts:create',
  'receivables:view',
  'receivables:create',
  'receivables:approve',
  'payments:view',
  'payments:create',
  'payments:approve',
  'expenses:view',
  'expenses:create',
  'users:view',
  'users:manage',
  'roles:view',
  'roles:manage',
  'pipelines:view',
  'pipelines:create',
  'audit:view',
];

async function mockApplication(page: Page) {
  const unexpected: string[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const requestedPeriod = new URL(request.url()).searchParams.get('period') ?? '6m';
    let body: unknown;
    if (pathname === '/v1/auth/me') {
      body = {
        user: { id: 'qa-admin', email: 'qa@example.test', name: 'QA', permissions },
        organization: { name: 'Organização QA' },
      };
    } else if (pathname === '/v1/dashboard/summary') {
      const monthCount = requestedPeriod === '3m' ? 3 : requestedPeriod === '12m' ? 12 : 6;
      const today = new Date();
      body = {
        activeClients: 0,
        activeMatters: 0,
        overdueReceivables: 0,
        openTasks: 0,
        period: requestedPeriod,
        bucket: requestedPeriod === 'all' ? 'year' : 'month',
        monthlyReceivables: Array.from(
          { length: requestedPeriod === 'all' ? 1 : monthCount },
          (_, index) => ({
            month:
              requestedPeriod === 'all'
                ? `${today.getUTCFullYear()}-01-01`
                : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + index, 1))
                    .toISOString()
                    .slice(0, 10),
            dueAmount: '0.00',
            receivedAmount: '0.00',
            outstandingAmount: '0.00',
            installments: 0,
          }),
        ),
      };
    } else if (pathname === '/v1/notifications') {
      body = { items: [], unread: 0 };
    } else if (pathname === '/v1/notifications/reconcile') {
      body = { reconciled: 0 };
    } else if (pathname.startsWith('/v1/reports/')) {
      body = { basis: 'qa', rows: [] };
    } else if (pathname === '/v1/health/live') {
      body = { status: 'ok' };
    } else if (
      pathname === '/v1/admin/users' ||
      pathname === '/v1/admin/roles' ||
      pathname === '/v1/pipelines' ||
      pathname === '/v1/tasks' ||
      pathname === '/v1/calendar-events'
    ) {
      body = [];
    } else if (
      [
        '/v1/clients',
        '/v1/matters',
        '/v1/documents',
        '/v1/finance/contracts',
        '/v1/finance/receivables',
        '/v1/finance/payments',
        '/v1/finance/expenses',
        '/v1/audit-logs',
      ].includes(pathname)
    ) {
      body = { items: [], total: 0 };
    } else {
      unexpected.push(`${request.method()} ${pathname}`);
      body = { message: 'Unexpected request' };
    }
    await route.fulfill({
      status: unexpected.length ? 500 : 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return unexpected;
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`every administrator module opens at ${viewport.width}px without overflow or accessibility errors`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const unexpected = await mockApplication(page);
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto('/');
    for (const [navigationLabel, heading] of modules) {
      if (viewport.width === 360) {
        await page.getByRole('button', { name: 'Abrir navegação' }).click();
      }
      await page
        .locator('#primary-navigation')
        .getByRole('button', { name: navigationLabel, exact: true })
        .click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.locator('main .loading')).toHaveCount(0);
      await expect(page.getByText('Funcionalidade indisponivel no contrato atual')).toHaveCount(0);
      if (navigationLabel === 'Visão geral') {
        const periodFilter = page.getByRole('combobox', { name: 'Período das contas a receber' });
        await expect(periodFilter).toHaveValue('6m');
        if (viewport.width === 1440) {
          await expect(page.getByText('Nenhuma parcela nos próximos seis meses.')).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Acesso rápido' })).toBeVisible();
        }
        await periodFilter.selectOption('all');
        await expect(page.getByText('Nenhuma parcela no período cadastrado.')).toBeVisible();
        await periodFilter.selectOption('12m');
        await expect(page.getByText('Nenhuma parcela nos próximos doze meses.')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(
        accessibility.violations.map((violation) => ({
          id: violation.id,
          targets: violation.nodes.map((node) => node.target),
        })),
        navigationLabel,
      ).toEqual([]);
    }
    expect(unexpected).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
}
