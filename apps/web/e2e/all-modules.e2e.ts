import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const modules = [
  ['Visão geral', 'Visão geral'],
  ['Clientes', 'Clientes'],
  ['Processos', 'Processos'],
  ['CRM jurídico e comercial', 'CRM jurídico e comercial'],
  ['Cobrança', 'CRM de cobranca'],
  ['Documentos', 'Documentos'],
  ['Tarefas', 'Tarefas'],
  ['Agenda', 'Agenda'],
  ['Notificações', 'Notificações'],
  ['Contratos', 'Contratos'],
  ['Recebíveis', 'Entradas, parcelas e pagamentos'],
  ['Relatórios', 'Relatórios'],
  ['Usuários e permissões', 'Equipe'],
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
  const createdMatters: Array<Record<string, unknown>> = [];
  const pipelines = [
    {
      id: 'commercial-qa',
      name: 'Comercial QA',
      kind: 'COMMERCIAL',
      stages: [
        { id: 'commercial-stage-qa', name: 'Contato inicial', position: 0, isTerminal: false },
      ],
    },
    {
      id: 'legal-qa',
      name: 'Jurídico QA',
      kind: 'LEGAL',
      stages: [{ id: 'legal-stage-qa', name: 'Triagem', position: 0, isTerminal: false }],
    },
    {
      id: 'collection-qa',
      name: 'Cobrança QA',
      kind: 'COLLECTION',
      stages: [
        { id: 'collection-stage-open-qa', name: 'Em atraso', position: 0, isTerminal: false },
        {
          id: 'collection-stage-negotiation-qa',
          name: 'Em negociação',
          position: 1,
          isTerminal: false,
        },
      ],
    },
  ];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const requestedPeriod = new URL(request.url()).searchParams.get('period') ?? '6m';
    let body: unknown;
    if (pathname === '/v1/auth/me') {
      body = {
        user: {
          id: 'qa-admin',
          email: 'qa@example.test',
          name: 'QA',
          permissions,
          isAdministrator: true,
        },
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
    } else if (pathname === '/v1/admin/access-alerts') {
      body = { enabled: false, times: ['09:00'], timezone: 'America/Sao_Paulo' };
    } else if (pathname.startsWith('/v1/reports/')) {
      body = { basis: 'qa', rows: [] };
    } else if (pathname === '/v1/health/live') {
      body = { status: 'ok' };
    } else if (pathname === '/v1/clients') {
      body = {
        items: [{ id: 'client-qa', displayName: 'Cliente QA' }],
        total: 1,
        page: 1,
        pageSize: 100,
        pages: 1,
      };
    } else if (pathname === '/v1/matters' && request.method() === 'POST') {
      const submission = request.postDataJSON() as Record<string, unknown>;
      createdMatters.push(submission);
      body = { id: 'matter-qa', ...submission };
    } else if (pathname === '/v1/matters' && request.method() === 'GET') {
      const collectionPipeline = pipelines.find((pipeline) => pipeline.kind === 'COLLECTION');
      const collectionStage = collectionPipeline?.stages[0];
      body = {
        items: createdMatters.map((matter, index) => {
          const objective = matter.collectionObjective as { description: string } | undefined;
          return {
            id: `matter-${index + 1}`,
            ...matter,
            status: 'LEAD',
            priority: 'MEDIUM',
            client: { id: 'client-qa', displayName: 'Cliente QA' },
            pipeline: collectionPipeline,
            currentStage: collectionStage,
            customFields: objective
              ? { collectionObjective: { kind: 'NON_FINANCIAL', ...objective } }
              : {},
          };
        }),
        total: createdMatters.length,
        page: 1,
        pageSize: 25,
        pages: createdMatters.length ? 1 : 0,
      };
    } else if (
      pathname === '/v1/admin/users' ||
      pathname === '/v1/admin/roles' ||
      pathname === '/v1/tasks' ||
      pathname === '/v1/calendar-events'
    ) {
      body = [];
    } else if (pathname === '/v1/pipelines') {
      body = pipelines;
    } else if (
      [
        '/v1/clients',
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
  return { unexpected, createdMatters };
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
    const { unexpected, createdMatters } = await mockApplication(page);
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
    await expect(
      page.locator('#primary-navigation').getByRole('button', {
        name: 'CRM comercial',
        exact: true,
      }),
    ).toHaveCount(0);
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
      if (navigationLabel === 'CRM jurídico e comercial') {
        await expect(page.getByRole('heading', { name: 'Comercial QA' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Jurídico QA' })).toBeVisible();
        await page.getByRole('button', { name: 'Nova oportunidade ou processo' }).click();
        const createRecordForm = page.locator('form').filter({
          has: page.getByLabel('Fluxo de atendimento'),
        });
        const pipeline = createRecordForm.getByLabel('Fluxo de atendimento');
        await expect(pipeline).toHaveAttribute('required', '');
        await expect(
          createRecordForm.getByLabel('Nome do processo ou da oportunidade'),
        ).toHaveCount(0);
        await pipeline.selectOption('commercial-qa');
        await expect(createRecordForm.getByLabel('Nome da oportunidade')).toBeVisible();
        await expect(createRecordForm.getByLabel('Número judicial ou CNJ (opcional)')).toHaveCount(
          0,
        );
        await pipeline.selectOption('legal-qa');
        await expect(createRecordForm.getByLabel('Nome do processo')).toBeVisible();
        await expect(
          createRecordForm.getByLabel('Número judicial ou CNJ (opcional)'),
        ).toBeVisible();
      }
      if (navigationLabel === 'Cobrança') {
        await page.getByRole('button', { name: 'Nova cobrança' }).click();
        const collectionForm = page.locator('form').filter({
          has: page.getByLabel('Fluxo de atendimento'),
        });
        await collectionForm.getByLabel('Cliente').selectOption('client-qa');
        await collectionForm.getByLabel('Código da cobrança').fill('COB-OBJ-001');
        await collectionForm
          .getByLabel('Identificação da cobrança', { exact: true })
          .fill('Regularizar documentos da cobrança');
        await collectionForm.getByLabel('Registrar objetivo sem valor financeiro').check();
        const objectiveDescription = collectionForm.getByLabel('Descreva o objetivo da negociação');
        await expect(objectiveDescription).toBeVisible();
        await objectiveDescription.fill(
          'Receber comprovantes para concluir a análise, sem negociar valores.',
        );
        await collectionForm.getByRole('button', { name: 'Cadastrar cobrança' }).click();
        await expect(page.getByText('Cobrança cadastrada.')).toBeVisible();
        await expect(page.getByText('Objetivo sem valor financeiro')).toBeVisible();
        expect(createdMatters.at(-1)).toMatchObject({
          clientId: 'client-qa',
          pipelineId: 'collection-qa',
          collectionObjective: {
            description: 'Receber comprovantes para concluir a análise, sem negociar valores.',
          },
        });
      }
      for (const selector of await page.locator('select').all()) {
        await expect(selector).toHaveCSS('appearance', 'none');
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
