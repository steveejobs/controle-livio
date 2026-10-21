import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`client registration, editing, contact and communication at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
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
    const contracts: Array<Record<string, unknown>> = [];
    const serviceCatalog: Array<Record<string, unknown>> = [];
    const documents: Array<Record<string, unknown>> = [];
    const receivables: Array<Record<string, unknown>> = [
      {
        id: 'receivable-qa',
        reference: 'HON-001',
        status: 'PARTIALLY_PAID',
        originalAmount: '100.0000',
        currency: 'BRL',
        dueDate: '2026-11-01',
        installments: [],
      },
    ];
    let outstanding = [{ currency: 'BRL', amount: '78.2500' }];
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const contentType = request.headers()['content-type'] ?? '';
      const body = contentType.includes('application/json')
        ? (request.postDataJSON() as Record<string, unknown> | null)
        : null;
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
              'contracts:view',
              'contracts:create',
              'receivables:view',
              'receivables:create',
              'payments:view',
              'documents:view',
              'documents:create',
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
          contracts,
          financial: {
            outstanding,
            receivables,
            payments: [],
          },
          documents,
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
      } else if (path === '/v1/finance/service-catalog' && method === 'GET') {
        result = serviceCatalog;
      } else if (path === '/v1/finance/service-catalog' && method === 'POST') {
        const service = { id: `service-${serviceCatalog.length + 1}`, ...body };
        serviceCatalog.push(service);
        result = service;
      } else if (path === '/v1/finance/contracts' && method === 'POST') {
        const contract = {
          id: 'contract-qa',
          status: 'DRAFT',
          currency: 'BRL',
          ...body,
        };
        contracts.push(contract);
        result = contract;
      } else if (path === '/v1/finance/receivables' && method === 'POST') {
        const installments = body?.installments as
          Array<{ sequence: number; amount: string; dueDate: string }> | undefined;
        const receivable = {
          id: 'receivable-new',
          status: 'OPEN',
          currency: 'BRL',
          reference: body?.reference,
          originalAmount: body?.originalAmount,
          dueDate: installments?.at(-1)?.dueDate,
          installments: installments ?? [],
        };
        receivables.unshift(receivable);
        outstanding = [{ currency: 'BRL', amount: '1078.2500' }];
        result = receivable;
      } else if (path === '/v1/documents' && method === 'POST') {
        const formData = request.postData() ?? '';
        const field = (name: string) =>
          formData.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]+)`))?.[1];
        const document = {
          id: `document-${documents.length + 1}`,
          title: field('title'),
          category: field('category'),
          visibility: field('visibility'),
          contractId: field('contractId'),
          updatedAt: '2026-10-21',
        };
        documents.unshift(document);
        result = document;
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
    await expect(page.locator('form select[name="type"]')).toHaveCSS('appearance', 'none');
    const createForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Cadastrar e abrir cliente',
      }),
    });
    await expect(createForm.getByLabel('Tipo de conta')).toHaveValue('PERSON');
    await createForm.getByLabel('CPF').fill('52998224725');
    await expect(createForm.getByLabel('CPF')).toHaveValue('529.982.247-25');
    await createForm.getByLabel('CPF').fill('04252011000110');
    await expect(createForm.getByLabel('Tipo de conta')).toHaveValue('COMPANY');
    await expect(createForm.getByLabel('CNPJ')).toHaveValue('04.252.011/0001-10');
    await createForm.getByLabel('Nome da empresa').fill('Cliente QA');
    await createForm.getByLabel('Razão social').fill('Cliente QA Serviços Jurídicos LTDA');
    await createForm.getByLabel('E-mail').fill('client@example.test');
    await createForm.getByLabel('Cidade').fill('São Paulo');
    await createForm.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    await expect(page.getByRole('heading', { name: 'Cliente QA' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Etapa 2: Financeiro' })).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/clients' && item.method === 'POST')?.body,
    ).toMatchObject({
      type: 'COMPANY',
      displayName: 'Cliente QA',
      legalName: 'Cliente QA Serviços Jurídicos LTDA',
      taxId: '04.252.011/0001-10',
      email: 'client@example.test',
      address: { city: 'São Paulo' },
    });
    await expect(page.getByText('R$ 78,25')).toBeVisible();

    const receivableForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Salvar cobrança' }),
    });
    await receivableForm.getByLabel('Referência da cobrança').fill('HON-2026-001');
    await receivableForm.getByLabel('O que está sendo cobrado').fill('Honorários iniciais');
    await receivableForm.getByLabel('Valor total (R$)').fill('1.000,00');
    await receivableForm.getByLabel('Quantidade de parcelas').fill('3');
    await receivableForm.locator('input[name="issueDate"]').fill('2026-10-21');
    await receivableForm.locator('input[name="firstDueDate"]').fill('2026-11-21');
    const saveReceivable = receivableForm.getByRole('button', { name: 'Salvar cobrança' });
    await saveReceivable.scrollIntoViewIfNeeded();
    await expect(saveReceivable).toBeEnabled();
    await saveReceivable.click();
    await expect(page.getByText('Cobrança e parcelas cadastradas.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Etapa 3: Honorários' })).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/finance/receivables' && item.method === 'POST')
        ?.body,
    ).toMatchObject({
      clientId: 'client-qa',
      reference: 'HON-2026-001',
      description: 'Honorários iniciais',
      originalAmount: '1000.00',
      issueDate: '2026-10-21',
      installments: [
        { sequence: 1, amount: '333.34', dueDate: '2026-11-21' },
        { sequence: 2, amount: '333.33', dueDate: '2026-12-21' },
        { sequence: 3, amount: '333.33', dueDate: '2027-01-21' },
      ],
    });

    const contractForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Salvar contrato' }),
    });
    await contractForm.getByLabel('Número do contrato').fill('H-2026-001');
    const feeModel = contractForm.getByLabel('Modelo de honorários');
    await feeModel.selectOption('SUCCESS');
    await expect(contractForm.getByLabel('Valor fixo (R$)')).toHaveCount(0);
    await contractForm.getByLabel('Percentual de êxito').fill('15');
    await feeModel.selectOption('MIXED');
    await contractForm.getByLabel('Valor fixo (R$)').fill('1.500,00');
    await contractForm.getByLabel('Percentual de êxito').fill('15');
    await contractForm.getByLabel('Acompanhamento em delegacia').check();
    await contractForm.getByRole('button', { name: 'Salvar novo serviço para reutilizar' }).click();
    await contractForm.getByLabel('Nome do serviço').fill('Plantão criminal');
    await contractForm.getByLabel('Área').selectOption('CRIMINAL');
    await contractForm.getByRole('button', { name: 'Salvar na lista' }).click();
    await expect(contractForm.getByLabel('Plantão criminal')).toBeChecked();
    await contractForm.getByRole('button', { name: 'Salvar contrato' }).click();
    await expect(page.getByText('Contrato de honorários cadastrado.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Etapa 4: Documentos' })).toBeVisible();
    expect(
      requests.find((item) => item.path === '/v1/finance/contracts' && item.method === 'POST')
        ?.body,
    ).toMatchObject({
      clientId: 'client-qa',
      number: 'H-2026-001',
      fixedAmount: '1500.00',
      feeModel: 'MIXED',
      successRate: '0.150000',
      currency: 'BRL',
      serviceNames: ['Acompanhamento em delegacia', 'Plantão criminal'],
    });
    expect(
      requests.find((item) => item.path === '/v1/finance/service-catalog' && item.method === 'POST')
        ?.body,
    ).toMatchObject({ name: 'Plantão criminal', area: 'CRIMINAL' });

    const documentForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Anexar documento' }),
    });
    const requiredDocuments: Array<[string, string]> = [
      ['CONTRATO_HONORARIOS', 'Contrato de honorários'],
      ['PROCURACAO', 'Procuração'],
      ['HIPOSSUFICIENCIA', 'Declaração de hipossuficiência'],
    ];
    for (const [index, [category, label]] of requiredDocuments.entries()) {
      await documentForm.getByLabel('Tipo de documento').selectOption(category);
      await documentForm.getByLabel('Arquivo').setInputFiles({
        name: `${category}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 QA'),
      });
      await documentForm.getByRole('button', { name: 'Anexar documento' }).click();
      await expect(page.getByText('Documento anexado com acesso interno.')).toBeVisible();
      if (index < requiredDocuments.length - 1) {
        const checklistItem = page.locator('.document-check-item').filter({ hasText: label });
        await expect(checklistItem.getByText(label, { exact: true })).toBeVisible();
        await expect(checklistItem.getByText('1 arquivo(s) anexado(s)')).toBeVisible();
      }
    }
    await expect(page.getByRole('heading', { name: 'Fluxo inicial concluído' })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir ficha completa' }).click();
    await expect(page.getByText('R$ 1.078,25')).toBeVisible();
    for (const [, label] of requiredDocuments) {
      const checklistItem = page.locator('.document-check-item').filter({ hasText: label });
      await expect(checklistItem.getByText('1 arquivo(s) anexado(s)')).toBeVisible();
    }
    await expect(
      page.locator('#honorarios-cliente').getByText('H-2026-001 · Honorários — Cliente QA'),
    ).toBeVisible();
    expect(
      requests.filter((item) => item.path === '/v1/documents' && item.method === 'POST'),
    ).toHaveLength(3);
    expect(documents.every((document) => document.visibility === 'INTERNAL')).toBe(true);
    expect(
      documents.find((document) => document.category === 'CONTRATO_HONORARIOS')?.contractId,
    ).toBe('contract-qa');

    const editForm = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Salvar alterações',
      }),
    });
    await editForm.getByLabel('Nome da empresa', { exact: true }).fill('Cliente QA editado');
    const clientUpdate = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === '/v1/clients/client-qa' && request.method() === 'PATCH'
      );
    });
    await editForm.getByRole('button', { name: 'Salvar alterações' }).click();
    await clientUpdate;
    await expect(page.getByRole('status').filter({ hasText: 'Cadastro atualizado.' })).toBeVisible({
      timeout: 15_000,
    });
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
