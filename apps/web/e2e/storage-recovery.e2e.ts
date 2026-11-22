import { expect, test } from '@playwright/test';

for (const width of [360, 1440])
  test(`recovery incident review with simulated API at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const incident = {
      id: '10000000-0000-4000-8000-000000000099',
      kind: 'REFERENCE_WITHOUT_OBJECT',
      bucket: 'legal-documents',
      objectKey: 'organizations/synthetic/documents/synthetic.pdf',
      state: 'OPEN',
      notificationUndelivered: true,
    };
    const decisions: Array<Record<string, unknown>> = [];
    await page.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname,
        method = route.request().method();
      let body: unknown,
        status = 200;
      if (path === '/v1/auth/me')
        body = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            permissions: ['users:view', 'storage_recovery:view', 'storage_recovery:manage'],
            isAdministrator: true,
          },
          organization: { name: 'Synthetic recovery QA' },
        };
      else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
      else if (path === '/v1/dashboard/summary')
        body = {
          activeClients: 0,
          activeMatters: 0,
          overdueReceivables: 0,
          openTasks: 0,
          monthlyReceivables: [],
        };
      else if (path === '/v1/admin/users') body = [];
      else if (path === '/v1/admin/access-alerts')
        body = { enabled: false, times: ['09:00'], timezone: 'America/Sao_Paulo' };
      else if (path === '/v1/storage-recovery' && method === 'GET')
        body = {
          incidents: [incident],
          pending: 1,
          overdue: 1,
          undelivered: 1,
          pageLimit: 50,
          workerEnabled: false,
          deletionEnabled: false,
          nextCursor: url.searchParams.has('afterId') ? null : incident.id,
        };
      else if (
        path === `/v1/storage-recovery/incidents/${incident.id}/decisions` &&
        method === 'POST'
      ) {
        decisions.push(route.request().postDataJSON());
        status = decisions.length === 1 ? 200 : 409;
        body =
          status === 200
            ? { state: 'OPEN' }
            : { message: 'Incidente já foi tratado em outra sessão' };
      } else throw new Error(`Unexpected recovery UI request: ${method} ${path}`);
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    await page.goto('/');
    if (width === 360) await page.getByRole('button', { name: 'Abrir navegação' }).click();
    await page
      .locator('#primary-navigation')
      .getByRole('button', { name: 'Usuários e permissões' })
      .click();
    const panel = page.getByRole('region', { name: 'Recuperação de arquivos' });
    await expect(panel.getByText('Alerta sem destinatário ativo.', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Próxima página de incidentes', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Próxima página de incidentes', exact: true }),
    ).toBeDisabled();
    await panel.getByRole('button', { name: 'Página anterior de incidentes', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Próxima página de incidentes', exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole('button', { name: `Revisar incidente ${incident.id}`, exact: true })
      .click();
    await panel
      .getByLabel('Motivo', { exact: true })
      .fill('Conservar fixture sintética e solicitar restauração verificada');
    await panel.getByRole('button', { name: 'Registrar decisão', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('incidente continua aberto');
    expect(decisions[0]).toEqual({
      action: 'RETAIN',
      reason: 'Conservar fixture sintética e solicitar restauração verificada',
    });
    await panel
      .getByRole('button', { name: `Revisar incidente ${incident.id}`, exact: true })
      .click();
    const decision = panel.getByRole('combobox', { name: 'Decisão', exact: true });
    await expect(decision).toHaveCount(1);
    await decision.selectOption('RETRY');
    await panel
      .getByLabel('Motivo', { exact: true })
      .fill('Nova avaliação autorizada da fixture sintética');
    await panel.getByRole('button', { name: 'Registrar decisão', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('outra sessão');
    expect(decisions[1]?.action).toBe('RETRY');
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((element) => element.getBoundingClientRect().right + scrollX > innerWidth + 1)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.textContent?.slice(0, 80),
          right: element.getBoundingClientRect().right + scrollX,
          left: element.getBoundingClientRect().left + scrollX,
          width: element.getBoundingClientRect().width,
          overflow: getComputedStyle(element).overflowX,
          scroll: element.scrollWidth,
        }))
        .slice(-30),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      JSON.stringify({
        overflow,
        dimensions: await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          viewport: innerWidth,
          body: document.body.scrollWidth,
          x: scrollX,
        })),
      }),
    ).toBe(true);
  });
