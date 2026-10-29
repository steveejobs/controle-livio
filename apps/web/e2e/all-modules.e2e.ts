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
  ['Atividades', 'Atividades do sistema'],
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
  'organization:view',
  'organization:update',
];

async function mockApplication(page: Page) {
  const unexpected: string[] = [];
  const createdMatters: Array<Record<string, unknown>> = [];
  const createdContracts: Array<Record<string, unknown>> = [];
  const moduleViews: string[] = [];
  const documentTemplates = [
    {
      category: 'CONTRATO_HONORARIOS',
      label: 'Contrato de honorários',
      content:
        'CONTRATO DE HONORÁRIOS\n\n{{cliente.qualificacao}}\n\n{{contrato.numero}}\n{{contrato.objeto}}\n{{contrato.honorarios}}',
      customized: false,
    },
    {
      category: 'PROCURACAO',
      label: 'Procuração',
      content: 'PROCURAÇÃO\n\n{{cliente.qualificacao}}\n{{escritorio.identificacao}}',
      customized: false,
    },
    {
      category: 'HIPOSSUFICIENCIA',
      label: 'Declaração de hipossuficiência',
      content: 'DECLARAÇÃO\n\n{{cliente.qualificacao}}\n{{data.emissao}}',
      customized: false,
    },
  ];
  const defaultDocumentTemplates = documentTemplates.map((template) => ({ ...template }));
  const templateVariables = [
    {
      token: '{{cliente.nome}}',
      label: 'Nome do cliente',
      description: 'Nome do cliente.',
      example: 'Marina Souza',
      categories: ['CONTRATO_HONORARIOS', 'PROCURACAO', 'HIPOSSUFICIENCIA'],
    },
    {
      token: '{{cliente.qualificacao}}',
      label: 'Qualificação completa',
      description: 'Qualificação do cliente.',
      example: 'Marina Souza, brasileira, CPF nº 123.456.789-00',
      categories: ['CONTRATO_HONORARIOS', 'PROCURACAO', 'HIPOSSUFICIENCIA'],
    },
    {
      token: '{{contrato.numero}}',
      label: 'Número do contrato',
      description: 'Número do contrato.',
      example: 'H-2026-001',
      categories: ['CONTRATO_HONORARIOS'],
    },
  ];
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
    let unexpectedRequest = false;
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
    } else if (pathname === '/v1/audit-logs/module-views' && request.method() === 'POST') {
      const submission = request.postDataJSON() as { module?: string };
      if (submission.module) moduleViews.push(submission.module);
      body = { recorded: true };
    } else if (pathname === '/v1/audit-logs/client-views' && request.method() === 'POST') {
      body = { recorded: true };
    } else if (pathname === '/v1/audit-logs/actors') {
      body = { items: [{ id: 'qa-admin', fullName: 'QA', email: 'qa@example.test' }], total: 1 };
    } else if (pathname === '/v1/audit-logs') {
      body = {
        items: [
          {
            id: 'activity:module-view',
            kind: 'NAVIGATION',
            action: 'MODULE_VIEW',
            resource: 'user',
            resourceId: 'qa-admin',
            summary: 'Abriu Clientes',
            changedFields: [],
            occurredAt: '2026-10-21T15:00:00.000Z',
            actorUserId: 'qa-admin',
            actorName: 'QA',
            actorEmail: 'qa@example.test',
          },
          {
            id: 'audit:client-update',
            kind: 'CHANGE',
            action: 'UPDATE',
            resource: 'client',
            resourceId: 'client-qa',
            targetLabel: 'Cliente QA',
            changedFields: ['Nome', 'Telefone'],
            occurredAt: '2026-10-21T14:00:00.000Z',
            actorUserId: 'qa-admin',
            actorName: 'QA',
            actorEmail: 'qa@example.test',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 25,
        pages: 1,
      };
    } else if (pathname === '/v1/documents/office-settings') {
      body = { configured: false, settings: null };
    } else if (pathname === '/v1/documents/templates' && request.method() === 'GET') {
      body = { templates: documentTemplates, variables: templateVariables };
    } else if (pathname === '/v1/documents/templates' && request.method() === 'PATCH') {
      const submission = request.postDataJSON() as { category: string; content: string };
      const template = documentTemplates.find((item) => item.category === submission.category);
      if (template) {
        template.content = submission.content;
        template.customized = true;
      }
      body = { templates: documentTemplates, variables: templateVariables };
    } else if (pathname.startsWith('/v1/documents/templates/') && request.method() === 'DELETE') {
      const category = pathname.split('/').at(-1);
      const template = documentTemplates.find((item) => item.category === category);
      const defaultTemplate = defaultDocumentTemplates.find((item) => item.category === category);
      if (template && defaultTemplate) Object.assign(template, defaultTemplate);
      body = { templates: documentTemplates, variables: templateVariables };
    } else if (pathname === '/v1/finance/expenses/approval-policy') {
      body = { required: false, canSubmitForApproval: true };
    } else if (pathname === '/v1/finance/expenses/summary') {
      body = { currencies: [] };
    } else if (pathname === '/v1/finance/expenses/responsibles') {
      body = [];
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
    } else if (pathname === '/v1/finance/service-catalog') {
      body = [];
    } else if (pathname === '/v1/finance/contracts' && request.method() === 'POST') {
      const submission = request.postDataJSON() as Record<string, unknown>;
      createdContracts.push(submission);
      body = { id: 'contract-qa', ...submission };
    } else if (pathname.match(/^\/v1\/matters\/[^/]+\/timeline$/)) {
      body = {
        matter: {
          id: 'matter-1',
          reference: 'COB-OBJ-001',
          title: 'Regularizar documentos da cobrança',
          status: 'LEAD',
          client: { id: 'client-qa', displayName: 'Cliente QA' },
        },
        entries: [
          {
            id: 'timeline-stage-qa',
            type: 'STAGE',
            title: 'Atendimento iniciado',
            occurredAt: '2026-10-20T12:00:00.000Z',
          },
          {
            id: 'timeline-hearing-qa',
            type: 'HEARING',
            title: 'Audiência de instrução',
            description: 'Fórum de Balsas',
            occurredAt: '2026-10-21T12:00:00.000Z',
          },
        ],
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
      unexpectedRequest = true;
      body = { message: 'Unexpected request' };
    }
    await route.fulfill({
      status: unexpectedRequest ? 500 : 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return { unexpected, createdMatters, createdContracts, moduleViews };
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
    const { unexpected, createdMatters, createdContracts, moduleViews } =
      await mockApplication(page);
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
        await page.getByRole('button', { name: 'Ver acompanhamento' }).click();
        await expect(
          page.getByRole('heading', { name: 'Regularizar documentos da cobrança' }),
        ).toBeVisible();
        await expect(page.getByText('Audiência de instrução')).toBeVisible();
        await expect(page.getByText('Atendimento iniciado')).toBeVisible();
        expect(createdMatters.at(-1)).toMatchObject({
          clientId: 'client-qa',
          pipelineId: 'collection-qa',
          collectionObjective: {
            description: 'Receber comprovantes para concluir a análise, sem negociar valores.',
          },
        });
      }
      if (navigationLabel === 'Contratos') {
        await page.getByRole('button', { name: 'Novo contrato' }).click();
        const contractForm = page.locator('form').filter({
          has: page.getByRole('button', { name: 'Cadastrar contrato' }),
        });
        await contractForm.getByLabel('Cliente').selectOption('client-qa');
        await contractForm.getByLabel('Número do contrato').fill('H-2026-003');
        await contractForm.getByLabel('Nome do contrato').fill('Defesa criminal');
        await contractForm.getByLabel('Valor fixo (R$)').fill('800,00');
        await contractForm.getByLabel('Este contrato inclui audiência').check();
        await contractForm.getByLabel('Data e horário').fill('2030-05-21T10:00');
        await contractForm.getByLabel('Outro intervalo (minutos)').fill('45');
        await contractForm.getByRole('button', { name: 'Adicionar alerta' }).click();
        await contractForm.getByRole('button', { name: 'Cadastrar contrato' }).click();
        await expect(page.getByText('Contrato cadastrado.')).toBeVisible();
        expect(createdContracts.at(-1)).toMatchObject({
          number: 'H-2026-003',
          hearings: [
            {
              reminderMinutes: [60, 45, 30, 10],
            },
          ],
        });
      }
      if (navigationLabel === 'Documentos') {
        await page.getByText('Modelos de documentos editáveis', { exact: true }).click();
        const editor = page.getByLabel('Texto do modelo');
        await expect(editor).toHaveValue(/\{\{cliente\.qualificacao\}\}/);
        await editor.focus();
        await editor.press('Control+End');
        await page.getByRole('button', { name: 'Nome do cliente' }).click();
        await expect(editor).toHaveValue(/\{\{cliente\.nome\}\}$/);
        await expect(page.getByText('Alterações não salvas')).toBeVisible();
        page.once('dialog', (dialog) => dialog.dismiss());
        await page.getByLabel('Documento para editar').selectOption('PROCURACAO');
        await expect(page.getByLabel('Documento para editar')).toHaveValue('CONTRATO_HONORARIOS');
        await expect(editor).toHaveValue(/\{\{cliente\.nome\}\}$/);
        await page.getByRole('button', { name: 'Ver prévia' }).click();
        await expect(page.getByText('Marina Souza', { exact: false }).last()).toBeVisible();
        await page.getByRole('button', { name: 'Salvar modelo' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Modelo salvo.' })).toBeVisible();
        await page.getByRole('button', { name: 'Restaurar modelo padrão' }).click();
        await expect(
          page.getByRole('status').filter({ hasText: 'Modelo padrão restaurado' }),
        ).toBeVisible();
      }
      if (navigationLabel === 'Atividades') {
        await expect(page.getByRole('heading', { name: 'Abriu Clientes' })).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Atualizou cadastro de cliente · Cliente QA' }),
        ).toBeVisible();
        await page.getByText('Campos alterados (2)').click();
        await expect(page.getByText('Nome · Telefone')).toBeVisible();
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
    if (viewport.width === 360) {
      await page.getByRole('button', { name: 'Abrir navegação' }).click();
    }
    await page.locator('#primary-navigation').getByRole('button', { name: 'Clientes' }).click();
    await expect
      .poll(() => moduleViews.filter((module) => module === 'clients').length)
      .toBeGreaterThanOrEqual(2);
    await expect.poll(() => moduleViews.length).toBeGreaterThanOrEqual(modules.length);
    expect(moduleViews).toContain('audit');
    expect(unexpected).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
}
