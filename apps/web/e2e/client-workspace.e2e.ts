import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`client registration, editing, contact and communication at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const client: Record<string, unknown> = {
      id: 'client-qa',
      type: 'PERSON',
      displayName: 'Cliente QA',
      updatedAt: '2026-10-20',
      address: { city: 'São Paulo' },
    };
    const contacts: Array<Record<string, unknown>> = [];
    const messages: Array<Record<string, unknown>> = [];
    const notes: Array<Record<string, unknown>> = [];
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const body = request.postDataJSON() as Record<string, unknown> | null;
      let result: unknown;
      if (path === '/v1/auth/me') {
        result = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            permissions: [
              'clients:view',
              'clients:create',
              'clients:update',
              'messages:create',
              'notes:create',
            ],
          },
          organization: { name: 'Organização QA' },
        };
      } else if (path === '/v1/dashboard/summary') {
        result = {
          activeClients: 0,
          activeMatters: 0,
          overdueReceivables: 0,
          openTasks: 0,
          monthlyReceivables: [],
        };
      } else if (path === '/v1/clients' && method === 'GET') {
        result = {
          items: requests.some((item) => item.path === '/v1/clients' && item.method === 'POST')
            ? [client]
            : [],
          total: requests.some((item) => item.path === '/v1/clients' && item.method === 'POST')
            ? 1
            : 0,
        };
      } else if (path === '/v1/clients' && method === 'POST') {
        Object.assign(client, body);
        result = client;
      } else if (path === '/v1/clients/client-qa/overview' && method === 'GET') {
        result = {
          client,
          contacts,
          matters: [],
          contracts: [],
          financial: { receivables: [], payments: [] },
          documents: [],
          internalNotes: notes,
          clientMessages: messages,
        };
      } else if (path === '/v1/clients/client-qa' && method === 'PATCH') {
        Object.assign(client, body);
        result = client;
      } else if (path === '/v1/clients/client-qa/contacts' && method === 'POST') {
        const contact = { id: 'contact-qa', ...body };
        contacts.push(contact);
        result = contact;
      } else if (path === '/v1/client-messages' && method === 'POST') {
        const message = { id: 'message-qa', publishedAt: '2026-10-20', ...body };
        messages.push(message);
        result = message;
      } else if (path === '/v1/internal-notes' && method === 'POST') {
        const note = { id: 'note-qa', createdAt: '2026-10-20', ...body };
        notes.push(note);
        result = note;
      } else {
        throw new Error(`Unexpected client request: ${method} ${path}`);
      }
      requests.push({ method, path, body: body ?? undefined });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(result),
      });
    });

    await page.goto('/');
    if (viewport.width === 360) await page.getByRole('button', { name: 'Abrir navegação' }).click();
    await page
      .getByRole('navigation', { name: 'Navegacao principal' })
      .getByRole('button', { name: 'Clientes' })
      .click();
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    const createForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Cadastrar e abrir cliente',
      }),
    });
    await createForm.getByLabel('Nome', { exact: true }).fill('Cliente QA');
    await createForm.getByLabel('E-mail').fill('client@example.test');
    await createForm.getByLabel('Cidade').fill('São Paulo');
    await createForm.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    await expect(page.getByRole('heading', { name: 'Cliente QA' })).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/clients' && item.method === 'POST')?.body,
    ).toMatchObject({
      displayName: 'Cliente QA',
      email: 'client@example.test',
      address: { city: 'São Paulo' },
    });

    const editForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Salvar alterações',
      }),
    });
    await editForm.getByLabel('Nome', { exact: true }).fill('Cliente QA editado');
    await editForm.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Cadastro atualizado.')).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/clients/client-qa' && item.method === 'PATCH')
        ?.body,
    ).toMatchObject({ displayName: 'Cliente QA editado' });

    await page.getByText('Adicionar outra pessoa').click();
    const contactForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Salvar contato',
      }),
    });
    await contactForm.getByLabel('Nome da pessoa').fill('Representante QA');
    await contactForm.getByRole('button', { name: 'Salvar contato' }).click();
    await expect(page.getByText('Contato adicionado.')).toBeVisible();
    await expect(page.getByText('Representante QA')).toBeVisible();

    const messageForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Publicar observação',
      }),
    });
    await messageForm.locator('textarea[name="body"]').fill('Observação QA para cliente');
    await messageForm.getByRole('button', { name: 'Publicar observação' }).click();
    await expect(page.getByText('Observação publicada para o cliente.')).toBeVisible();
    const noteForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Salvar nota',
      }),
    });
    await noteForm.locator('textarea[name="body"]').fill('Nota interna QA');
    await noteForm.getByRole('button', { name: 'Salvar nota' }).click();
    await expect(page.getByText('Nota interna salva.')).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/client-messages' && item.method === 'POST')?.body,
    ).toMatchObject({ clientId: 'client-qa' });
    expect(
      requests.find((item) => item.path === '/v1/internal-notes' && item.method === 'POST')?.body,
    ).toMatchObject({ clientId: 'client-qa' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
