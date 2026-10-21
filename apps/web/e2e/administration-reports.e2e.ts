import { expect, test } from '@playwright/test';

const reports = [
  'receivables-due',
  'received',
  'accrual',
  'overdue',
  'aging',
  'cash-forecast',
  'partial-payments',
  'active-contracts',
  'revenue-by-lawyer',
  'revenue-by-service',
  'delinquent-clients',
  'reconciliation',
];

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`administrator actions, pipeline stages and all reports at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const pipelines: Array<Record<string, unknown>> = [];
    const users: Array<Record<string, unknown>> = [];
    let accessAlertSettings = { enabled: false, times: ['09:00'], timezone: 'America/Sao_Paulo' };
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const submitted = request.postDataJSON() as Record<string, unknown> | null;
      let body: unknown;
      if (path === '/v1/auth/me') {
        body = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            permissions: [
              'users:view',
              'users:manage',
              'roles:view',
              'roles:manage',
              'pipelines:view',
              'pipelines:manage',
              'reports:view',
              'reports:export',
            ],
            isAdministrator: true,
          },
          organization: { name: 'Organização QA' },
        };
      } else if (path === '/v1/dashboard/summary') {
        body = {
          activeClients: 0,
          activeMatters: 0,
          overdueReceivables: 0,
          openTasks: 0,
          monthlyReceivables: [],
        };
      } else if (path === '/v1/admin/users' && method === 'GET') {
        body = users;
      } else if (path === '/v1/admin/access-alerts' && method === 'GET') {
        body = accessAlertSettings;
      } else if (path === '/v1/admin/access-alerts' && method === 'PATCH') {
        accessAlertSettings = {
          ...accessAlertSettings,
          ...submitted,
        } as typeof accessAlertSettings;
        body = accessAlertSettings;
      } else if (path === '/v1/admin/users' && method === 'POST') {
        const user = {
          id: 'user-1',
          status: 'INVITED',
          email: submitted?.email,
          fullName: submitted?.fullName,
          roles: [{ role: { name: 'Advogado' } }],
        };
        users.push(user);
        body = user;
      } else if (path === '/v1/admin/users/user-1/status' && method === 'PATCH') {
        users[0] = { ...users[0], status: submitted?.status };
        body = users[0];
      } else if (path === '/v1/admin/roles' && method === 'GET') {
        body = [
          { id: 'role-lawyer', key: 'lawyer', name: 'Advogado' },
          { id: 'role-secretary', key: 'secretary', name: 'Secretaria' },
        ];
      } else if (path === '/v1/admin/system-roles/reconcile' && method === 'POST') {
        body = [];
      } else if (path === '/v1/pipelines' && method === 'GET') {
        body = pipelines;
      } else if (path === '/v1/pipelines' && method === 'POST') {
        const stages = submitted?.stages as Array<Record<string, unknown>>;
        const pipeline = {
          id: 'pipeline-1',
          name: submitted?.name,
          kind: submitted?.kind,
          stages: stages.map((stage) => ({ id: 'stage-1', ...stage, isActive: true })),
        };
        pipelines.push(pipeline);
        body = pipeline;
      } else if (path === '/v1/pipelines/pipeline-1/stages' && method === 'POST') {
        const stage = { id: 'stage-2', ...submitted, isActive: true };
        (pipelines[0]?.stages as Array<Record<string, unknown>>).push(stage);
        body = stage;
      } else if (path === '/v1/pipelines/pipeline-1/stages/stage-1' && method === 'PATCH') {
        const stage = (pipelines[0]?.stages as Array<Record<string, unknown>>)[0];
        if (!stage) throw new Error('Missing QA stage');
        Object.assign(stage, submitted);
        body = stage;
      } else if (path.startsWith('/v1/reports/') && path.endsWith('/export.csv')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/csv',
          headers: { 'access-control-allow-origin': '*' },
          body: '\ufeffmonth,amount\n2026-10,10.00\n',
        });
        requests.push({ method, path });
        return;
      } else if (path.startsWith('/v1/reports/')) {
        body = { basis: 'qa', rows: [] };
      } else {
        throw new Error(`Unexpected API request: ${method} ${path}`);
      }
      requests.push({ method, path, body: submitted ?? undefined });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });

    const navigate = async (label: string) => {
      if (viewport.width === 360)
        await page.getByRole('button', { name: 'Abrir navegação' }).click();
      await page.locator('#primary-navigation').getByRole('button', { name: label }).click();
    };
    await page.goto('/');
    await navigate('Usuários e permissões');
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Resumo de acessos' })).toBeVisible();
    await page.getByLabel('Receber resumo automático de acessos').check();
    await page.getByLabel('Horário 1').fill('09:15');
    await page.getByRole('button', { name: 'Adicionar horário' }).click();
    await page.getByRole('button', { name: 'Salvar horários' }).click();
    await expect(page.getByRole('status')).toContainText('Horários dos alertas');
    expect(
      requests.find(
        (request) => request.path === '/v1/admin/access-alerts' && request.method === 'PATCH',
      )?.body,
    ).toMatchObject({ enabled: true, times: ['09:15', '09:00'] });
    expect(requests.filter((request) => request.path.endsWith('/reconcile'))).toHaveLength(0);
    await page.getByLabel('Nome completo').fill('Profissional QA');
    await page.getByLabel('E-mail profissional').fill('professional@example.test');
    await page.getByLabel('Perfil de acesso').selectOption('role-lawyer');
    await page.getByRole('button', { name: 'Cadastrar e enviar convite' }).click();
    await expect(page.getByText('Convite enviado.')).toBeVisible();
    expect(
      requests.find((request) => request.path === '/v1/admin/users' && request.method === 'POST')
        ?.body,
    ).toMatchObject({ roleIds: ['role-lawyer'], email: 'professional@example.test' });
    await page.getByRole('button', { name: 'Atualizar permissões padrão' }).click();
    await expect
      .poll(() => requests.filter((request) => request.path.endsWith('/reconcile')).length)
      .toBe(1);

    await navigate('Pipelines');
    await page.getByRole('button', { name: 'Novo pipeline' }).click();
    await page.getByLabel('Nome do fluxo').fill('Fluxo QA');
    const pipelineKind = page.getByLabel('Tipo de fluxo');
    await expect(pipelineKind).toHaveValue('LEGAL');
    await expect(page.getByLabel('Nome da primeira etapa')).toHaveAttribute(
      'placeholder',
      'Triagem',
    );
    await pipelineKind.selectOption('COMMERCIAL');
    await expect(page.getByLabel('Nome da primeira etapa')).toHaveAttribute(
      'placeholder',
      'Novo contato',
    );
    await page.getByLabel('Nome da primeira etapa').fill('Entrada');
    await page.getByRole('button', { name: 'Criar pipeline' }).click();
    await expect(page.getByRole('heading', { name: 'Fluxo QA' })).toBeVisible();
    await page.getByRole('button', { name: 'Adicionar etapa' }).click();
    await page.getByLabel('Nome da etapa').fill('Conclusão');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByText('Etapa adicionada.')).toBeVisible();
    await page.getByRole('button', { name: 'Desativar' }).first().click();
    await expect(page.getByText('Etapa atualizada.')).toBeVisible();

    await navigate('Relatórios');
    await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
    const reportSelect = page.getByRole('combobox', { name: 'Relatório' });
    for (const report of reports) {
      await reportSelect.selectOption(report);
      await expect
        .poll(() => requests.some((request) => request.path.startsWith(`/v1/reports/${report}`)))
        .toBe(true);
    }
    await reportSelect.selectOption('receivables-due');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('livio-receivables-due.csv');
    expect(requests.some((request) => request.path.endsWith('/export.csv'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
