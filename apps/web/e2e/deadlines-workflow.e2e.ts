import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/Sao_Paulo' });

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`task deadlines, reminder, calendar and notification actions at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const actions: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let task: Record<string, unknown> | undefined;
    let event: Record<string, unknown> | undefined;
    let notificationRead = false;
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const submitted = request.postDataJSON() as Record<string, unknown> | null;
      let body: unknown;
      if (path === '/v1/audit-logs/module-views' && method === 'POST') {
        body = { recorded: true };
      } else if (path === '/v1/auth/me') {
        body = {
          user: {
            id: 'qa-work',
            email: 'qa@example.test',
            permissions: [
              'tasks:view',
              'tasks:create',
              'tasks:update',
              'calendar:view',
              'calendar:create',
              'calendar:update',
              'notifications:view',
              'notifications:update',
            ],
          },
          organization: { name: 'Organização QA' },
        };
      } else if (path === '/v1/tasks' && method === 'GET') {
        body = task ? [task] : [];
      } else if (path === '/v1/tasks' && method === 'POST') {
        task = { id: 'task-1', ...submitted, reminders: [] };
        body = task;
      } else if (path === '/v1/tasks/task-1' && method === 'PATCH') {
        task = { ...task, ...submitted };
        body = task;
      } else if (path === '/v1/tasks/task-1/comments' && method === 'POST') {
        body = { id: 'comment-1', ...submitted };
      } else if (path === '/v1/tasks/task-1/reminders' && method === 'POST') {
        task = { ...task, reminders: [{ id: 'reminder-1', ...submitted }] };
        body = { id: 'reminder-1', ...submitted };
      } else if (path === '/v1/calendar-events' && method === 'GET') {
        body = event ? [event] : [];
      } else if (path === '/v1/calendar-events' && method === 'POST') {
        event = { id: 'event-1', ...submitted };
        body = event;
      } else if (path === '/v1/calendar-events/event-1' && method === 'PATCH') {
        event = { ...event, ...submitted };
        body = event;
      } else if (path === '/v1/notifications' && method === 'GET') {
        body = {
          unread: notificationRead ? 0 : 1,
          items: [
            {
              id: 'notice-1',
              title: 'Prazo próximo',
              body: 'Ação necessária',
              status: notificationRead ? 'READ' : 'UNREAD',
              createdAt: '2026-10-20T12:00:00Z',
            },
          ],
        };
      } else if (path === '/v1/notifications/reconcile' && method === 'POST') {
        body = { reconciled: 1 };
      } else if (path === '/v1/notifications/notice-1/read' && method === 'PATCH') {
        notificationRead = true;
        body = { id: 'notice-1', status: 'READ' };
      } else {
        throw new Error(`Unexpected API request: ${method} ${path}`);
      }
      if (method !== 'GET') actions.push({ method, path, body: submitted ?? undefined });
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
    await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();
    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    await page.getByLabel('O que precisa ser feito').fill('Preparar audiência');
    await page.getByLabel('Prazo').fill('2026-11-03T15:00');
    await page.getByRole('button', { name: 'Criar tarefa' }).click();
    await expect(page.getByText('Tarefa criada.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Preparar audiência' })).toBeVisible();
    expect(
      actions.find((action) => action.path === '/v1/tasks' && action.method === 'POST')?.body
        ?.dueAt,
    ).toBe('2026-11-03T18:00:00.000Z');
    await page
      .getByRole('combobox', { name: 'Status de Preparar audiência' })
      .selectOption('COMPLETED');
    await expect(page.getByText('Tarefa atualizada.')).toBeVisible();
    await page.getByRole('button', { name: 'Detalhes' }).click();
    await page.getByLabel('Comentário').fill('Documento revisado');
    await page.getByRole('button', { name: 'Adicionar comentário' }).click();
    await expect(page.getByText('Comentário adicionado.')).toBeVisible();
    await page.getByLabel('Lembrar em').fill('2026-11-02T09:00');
    await page.getByRole('button', { name: 'Programar lembrete' }).click();
    await expect(page.getByText('Lembrete programado.')).toBeVisible();
    expect(actions.find((action) => action.path.endsWith('/reminders'))?.body?.remindAt).toBe(
      '2026-11-02T12:00:00.000Z',
    );

    await navigate('Agenda');
    await page.getByRole('button', { name: 'Novo compromisso' }).click();
    await page.getByLabel('Nome do compromisso').fill('Audiência QA');
    await page.getByLabel('Início').fill('2026-11-03T15:00');
    await page.getByLabel('Fim').fill('2026-11-03T16:00');
    await page.getByLabel('Tipo de compromisso').selectOption('HEARING');
    await page.getByRole('button', { name: 'Criar evento' }).click();
    await expect(page.getByRole('heading', { name: 'Audiência QA' })).toBeVisible();
    expect(
      actions.find((action) => action.path === '/v1/calendar-events' && action.method === 'POST')
        ?.body,
    ).toMatchObject({
      startsAt: '2026-11-03T18:00:00.000Z',
      endsAt: '2026-11-03T19:00:00.000Z',
      timezone: 'America/Sao_Paulo',
    });
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Local').fill('Sala 2');
    await page.getByRole('button', { name: 'Salvar evento' }).click();
    await expect(page.getByText('Compromisso atualizado.')).toBeVisible();

    await navigate('Notificações');
    await expect(page.getByText('Prazo próximo')).toBeVisible();
    await page.getByRole('button', { name: 'Prazo próximo Ação necessária' }).click();
    await expect(page.getByText('0', { exact: true })).toBeVisible();
    expect(actions.some((action) => action.path.endsWith('/notice-1/read'))).toBe(true);
    await page.getByRole('button', { name: 'Atualizar alertas' }).click();
    await expect
      .poll(() => actions.filter((action) => action.path === '/v1/notifications/reconcile').length)
      .toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
