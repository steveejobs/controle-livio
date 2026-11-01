import { expect, test } from '@playwright/test';

const reports = [
  'receivables-due',
  'received',
  'accrual',
  'overdue',
  'aging',
  'cash-forecast',
  'cash-flow',
  'cash-flow-by-client',
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
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.assign(window, { copiedLinksQA: copied });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            copied.push(value);
          },
        },
      });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests: Array<{
      method: string;
      path: string;
      query?: string;
      body?: Record<string, unknown>;
    }> = [];
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
      if (path === '/v1/audit-logs/module-views' && method === 'POST') {
        body = { recorded: true };
      } else if (path === '/v1/auth/me') {
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
          id: `user-${users.length + 1}`,
          status: 'ACTIVE',
          email: submitted?.email,
          fullName: submitted?.fullName,
          roles: [{ role: { name: 'Advogado' } }],
        };
        users.push(user);
        body = {
          ...user,
          ...(submitted?.delivery === 'EMAIL'
            ? {}
            : {
                invitationUrl:
                  'https://example.test/auth/confirm?token_hash=qa-test&type=invite&next=/reset-password',
              }),
        };
      } else if (path === '/v1/admin/users/user-1/status' && method === 'PATCH') {
        users[0] = { ...users[0], status: submitted?.status };
        body = users[0];
      } else if (path === '/v1/admin/users/user-1/recovery-link' && method === 'POST') {
        body = {
          recoveryUrl: 'https://example.test/auth/confirm?token_hash=qa-recovery&type=recovery',
        };
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
        requests.push({ method, path, query: url.search });
        return;
      } else if (path.startsWith('/v1/reports/')) {
        body = { basis: 'qa', rows: [] };
      } else {
        throw new Error(`Unexpected API request: ${method} ${path}`);
      }
      requests.push({ method, path, query: url.search, body: submitted ?? undefined });
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
    for (let index = 0; index < 3; index += 1)
      await page.getByRole('button', { name: 'Adicionar horário' }).click();
    await expect(page.getByRole('button', { name: 'Adicionar horário' })).toBeDisabled();
    await page.getByRole('button', { name: 'Remover horário 2', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Adicionar horário' })).toBeEnabled();
    await page.getByRole('button', { name: 'Salvar horários' }).click();
    await expect
      .poll(
        () =>
          requests.filter((r) => r.path === '/v1/admin/access-alerts' && r.method === 'PATCH')
            .length,
      )
      .toBe(2);
    expect(
      requests.filter((r) => r.path === '/v1/admin/access-alerts' && r.method === 'PATCH').at(-1)
        ?.body,
    ).toMatchObject({ times: ['09:15', '12:00', '15:00', '18:00'] });
    expect(requests.filter((request) => request.path.endsWith('/reconcile'))).toHaveLength(0);
    await page.getByLabel('Nome completo').fill('Profissional QA');
    await page.getByLabel('E-mail profissional').fill('professional@example.test');
    await page.getByLabel('Perfil de acesso').selectOption('role-lawyer');
    await page.getByRole('button', { name: 'Cadastrar e gerar convite' }).click();
    await expect(
      page.getByText(
        'Acesso criado. Compartilhe o link de convite com o profissional para ele definir a senha.',
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Link de convite', { exact: true })).toHaveValue(
      /token_hash=qa-test/,
    );
    await page.getByRole('button', { name: 'Copiar link', exact: true }).click();
    await expect(page.getByText('Link de convite copiado.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ocultar link', exact: true }).click();
    await expect(page.getByLabel('Link de convite', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Redefinir senha' })).toBeVisible();
    await page.getByRole('button', { name: 'Redefinir senha' }).click();
    await expect(page.getByLabel('Link de redefinição de senha')).toHaveValue(
      /token_hash=qa-recovery/,
    );
    await page.getByRole('button', { name: 'Copiar link', exact: true }).click();
    await expect(page.getByText('Link de redefinição copiado.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'copiedLinksQA') as string[])).toEqual([
      'https://example.test/auth/confirm?token_hash=qa-test&type=invite&next=/reset-password',
      'https://example.test/auth/confirm?token_hash=qa-recovery&type=recovery',
    ]);
    await page.getByRole('button', { name: 'Ocultar link', exact: true }).click();
    await expect(page.getByLabel('Link de redefinição de senha')).toHaveCount(0);
    expect(
      requests.find((request) => request.path === '/v1/admin/users' && request.method === 'POST')
        ?.body,
    ).toMatchObject({ roleIds: ['role-lawyer'], email: 'professional@example.test' });
    await page.getByRole('button', { name: 'Suspender', exact: true }).click();
    await expect(page.getByText('Usuário suspenso.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redefinir senha', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reativar', exact: true }).click();
    await expect(page.getByText('Usuário reativado.', { exact: true })).toBeVisible();
    expect(requests.filter((r) => r.path.endsWith('/status')).map((r) => r.body?.status)).toEqual([
      'SUSPENDED',
      'ACTIVE',
    ]);
    await page.getByLabel('Nome completo').fill('Secretaria QA');
    await page.getByLabel('E-mail profissional').fill('secretary@example.test');
    await page.getByLabel('Perfil de acesso').selectOption('role-secretary');
    await page.getByRole('combobox', { name: 'Como entregar o convite' }).selectOption('EMAIL');
    await page.getByRole('button', { name: 'Cadastrar e enviar convite', exact: true }).click();
    await expect(
      page.getByText(
        'Convite enviado. O profissional poderá definir a senha e entrar pelo login normal.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      requests.filter((r) => r.path === '/v1/admin/users' && r.method === 'POST').at(-1)?.body,
    ).toMatchObject({
      delivery: 'EMAIL',
      roleIds: ['role-secretary'],
      email: 'secretary@example.test',
    });
    await expect(page.getByLabel('Link de convite', { exact: true })).toHaveCount(0);
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
      if (report === 'received') {
        await page.getByLabel('Data inicial').fill('2026-01-01');
        await page.getByLabel('Data final').fill('2026-11-30');
        for (const group of ['day', 'week', 'month']) {
          await page.getByRole('combobox', { name: 'Agrupar por' }).selectOption(group);
          await expect
            .poll(() =>
              requests.some(
                (request) =>
                  request.path === '/v1/reports/received' &&
                  new URLSearchParams(request.query).get('groupBy') === group &&
                  new URLSearchParams(request.query).get('to') === '2026-11-30',
              ),
            )
            .toBe(true);
        }
      }
      await expect
        .poll(() => requests.some((request) => request.path.startsWith(`/v1/reports/${report}`)))
        .toBe(true);
      await test.step(`export CSV ${report}`, async () => {
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 10_000 }),
            page.getByRole('button', { name: 'Exportar CSV' }).click(),
          ]);
          expect(download.suggestedFilename()).toBe(`livio-${report}.csv`);
          expect(await download.failure()).toBeNull();
        } catch (error) {
          const requested = requests.some(
            (request) => request.path === `/v1/reports/${report}/export.csv`,
          );
          throw new Error(`CSV_DOWNLOAD_FAILED report=${report} requestObserved=${requested}`, {
            cause: error,
          });
        }
      });
    }
    await reportSelect.selectOption('receivables-due');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('livio-receivables-due.csv');
    expect(await download.failure()).toBeNull();
    expect(requests.some((request) => request.path.endsWith('/export.csv'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
