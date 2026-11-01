import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`client registration, editing, contact and communication at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const documentUploads: string[] = [];
    const ocrAssetsLoaded = new Set<string>();
    let identityImageData = '';
    page.on('requestfinished', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/ocr/')) ocrAssetsLoaded.add(path);
    });
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
      if (path === '/v1/audit-logs/module-views' && method === 'POST') {
        result = { recorded: true };
      } else if (path === '/v1/audit-logs/client-views' && method === 'POST') {
        result = { recorded: true };
      } else if (path === '/v1/auth/me') {
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
      } else if (path === '/v1/clients/client-qa/photo-url' && method === 'GET') {
        result = {
          url: client.photoStorageKey
            ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII='
            : null,
        };
      } else if (path === '/v1/clients/client-qa/photo' && method === 'POST') {
        client.photoStorageKey = 'foto-qa';
        result = {
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII=',
        };
      } else if (path === '/v1/clients/client-qa/photo' && method === 'DELETE') {
        client.photoStorageKey = null;
        result = { url: null };
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
        const receivableId = body?.receivableId;
        if (typeof receivableId === 'string') {
          const receivable = receivables.find((item) => item.id === receivableId);
          if (receivable) receivable.contractId = contract.id;
        }
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
          description: body?.description,
          originalAmount: body?.originalAmount,
          contractId: body?.contractId ?? null,
          dueDate: installments?.at(-1)?.dueDate,
          installments: installments ?? [],
        };
        receivables.unshift(receivable);
        outstanding = [{ currency: 'BRL', amount: '1078.2500' }];
        result = receivable;
      } else if (path === '/v1/documents/generate' && method === 'POST') {
        const document = {
          id: `document-${documents.length + 1}`,
          title: `Gerado automaticamente · ${body?.category}`,
          category: body?.category,
          visibility: 'INTERNAL',
          contractId: body?.contractId ?? null,
          updatedAt: '2026-10-21',
        };
        documents.unshift(document);
        result = document;
      } else if (path === '/v1/documents' && method === 'POST') {
        const formData = request.postData() ?? '';
        documentUploads.push(formData);
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
    if (viewport.width === 360) {
      identityImageData = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1800;
        canvas.height = 920;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#111';
        context.font = 'bold 58px Arial';
        [
          'NOME: MARIA DA SILVA SOUZA',
          'CPF: 529.982.247-25',
          'RG: 123456789',
          'SSP/MA',
          'DATA DE NASCIMENTO: 24/05/1990',
        ].forEach((line, index) => context.fillText(line, 70, 130 + index * 150));
        return canvas.toDataURL('image/png').split(',')[1]!;
      });
      await createForm.getByLabel('Escolher foto do documento').setInputFiles({
        name: 'documento-qa.png',
        mimeType: 'image/png',
        buffer: Buffer.from(identityImageData, 'base64'),
      });
      await createForm.getByRole('button', { name: 'Ler dados do documento' }).click();
      await expect(createForm.getByLabel('Nome encontrado')).toHaveValue('MARIA DA SILVA SOUZA', {
        timeout: 120_000,
      });
      await expect(createForm.getByLabel('CPF encontrado')).toHaveValue('52998224725');
      await expect(createForm.getByLabel('RG encontrado')).toHaveValue('123456789');
      expect(ocrAssetsLoaded).toEqual(
        new Set(['/ocr/worker.min.js', '/ocr/tesseract-core.wasm.js', '/ocr/por.traineddata.gz']),
      );
      await createForm.getByRole('button', { name: 'Usar dados no cadastro' }).click();
      await expect(createForm.getByLabel('Nome completo')).toHaveValue('MARIA DA SILVA SOUZA');
      await expect(createForm.getByLabel('CPF', { exact: true })).toHaveValue('529.982.247-25');
      await expect(createForm.getByText(/Dados aplicados ao cadastro/)).toBeVisible();
      await createForm.getByText('Qualificação para documentos').click();
      await expect(createForm.locator('input[name="legalIdentity.birthDate"]')).toHaveValue(
        '1990-05-24',
      );
    }
    await createForm.getByLabel('CPF').fill('52998224725');
    await expect(createForm.getByLabel('CPF')).toHaveValue('529.982.247-25');
    await createForm.getByLabel('CPF').fill('04252011000110');
    await expect(createForm.getByLabel('Tipo de conta')).toHaveValue('COMPANY');
    await expect(createForm.getByLabel('CNPJ')).toHaveValue('04.252.011/0001-10');
    await createForm.getByLabel('Nome da empresa').fill('Cliente QA');
    await createForm.getByLabel('Razão social').fill('Cliente QA Serviços Jurídicos LTDA');
    await createForm.getByText('Representante legal para documentos').click();
    await createForm.getByLabel('Nome do representante').fill('Representante QA');
    await createForm.getByLabel('CPF do representante').fill('52998224725');
    await expect(createForm.getByLabel('CPF do representante')).toHaveValue('529.982.247-25');
    await createForm.getByLabel('E-mail').fill('client@example.test');
    await createForm.getByLabel('Telefone').fill('(98) 99999-1234');
    await createForm.getByLabel('Logradouro').fill('Rua Central');
    await createForm.getByLabel('Cidade').fill('São Paulo');
    await createForm.getByLabel('Estado (UF)').fill('SP');
    await createForm.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
    await expect(page.getByRole('heading', { name: 'Cliente QA' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Etapa 2: Financeiro' })).toBeVisible();
    await expect
      .poll(
        () =>
          requests.filter(
            (item) => item.path === '/v1/audit-logs/client-views' && item.method === 'POST',
          ).length,
      )
      .toBe(1);
    expect(
      requests.find((item) => item.path === '/v1/audit-logs/client-views' && item.method === 'POST')
        ?.body,
    ).toEqual({ clientId: 'client-qa' });
    if (viewport.width === 360) {
      expect(documentUploads).toHaveLength(1);
      expect(documentUploads[0]).toContain('IDENTIFICACAO');
      expect(documentUploads[0]).toContain('client-qa');
    }
    expect(
      requests.find((item) => item.path === '/v1/clients' && item.method === 'POST')?.body,
    ).toMatchObject({
      type: 'COMPANY',
      displayName: 'Cliente QA',
      legalName: 'Cliente QA Serviços Jurídicos LTDA',
      taxId: '04.252.011/0001-10',
      email: 'client@example.test',
      address: { street: 'Rua Central', city: 'São Paulo', state: 'SP' },
      customFields: {
        legalRepresentative: { name: 'Representante QA', taxId: '52998224725' },
      },
    });
    await expect(page.getByText('R$ 78,25', { exact: true })).toBeVisible();

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
    await expect(
      contractForm.getByLabel('Cobrança deste contrato').locator('option[value="receivable-new"]'),
    ).toHaveCount(1);
    await contractForm.getByLabel('Número do contrato').fill('H-2026-001');
    const feeModel = contractForm.getByLabel('Modelo de honorários');
    await feeModel.selectOption('SUCCESS');
    await expect(contractForm.getByLabel('Valor fixo (R$)')).toHaveCount(0);
    await contractForm.getByLabel('Percentual de êxito').fill('15');
    await feeModel.selectOption('MIXED');
    await contractForm.getByLabel('Valor fixo (R$)').fill('1.000,00');
    await contractForm.getByLabel('Percentual de êxito').fill('15');
    await contractForm.getByLabel('Cobrança deste contrato').selectOption('receivable-new');
    await contractForm.getByLabel('Acompanhamento em delegacia').check();
    await expect(contractForm.getByLabel('Este contrato inclui audiência')).not.toBeChecked();
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
      fixedAmount: '1000.00',
      feeModel: 'MIXED',
      successRate: '0.150000',
      currency: 'BRL',
      receivableId: 'receivable-new',
      serviceNames: ['Acompanhamento em delegacia', 'Plantão criminal'],
      hearings: [],
    });
    expect(
      requests.find((item) => item.path === '/v1/finance/service-catalog' && item.method === 'POST')
        ?.body,
    ).toMatchObject({ name: 'Plantão criminal', area: 'CRIMINAL' });

    const scannedContractForm = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Guardar contrato' }) });
    await expect(scannedContractForm.getByLabel('Contrato cadastrado (opcional)')).toBeVisible();
    await scannedContractForm
      .getByLabel('Contrato cadastrado (opcional)')
      .selectOption('contract-qa');
    await scannedContractForm.getByLabel('Arquivo do contrato').setInputFiles({
      name: 'contrato-assinado.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nContrato assinado de teste'),
    });
    await scannedContractForm.getByRole('button', { name: 'Guardar contrato' }).click();
    await expect(page.getByText('Contrato digitalizado salvo com acesso interno.')).toBeVisible();
    const savedScan = documents.find(
      (document) =>
        typeof document.title === 'string' && document.title.includes('contrato-assinado.pdf'),
    );
    expect(savedScan).toMatchObject({
      category: 'CONTRATO_HONORARIOS',
      visibility: 'INTERNAL',
      contractId: 'contract-qa',
    });
    expect(savedScan?.title).toContain('H-2026-001');

    const documentGenerator = page.locator('.document-generation');
    const requiredDocuments: Array<[string, string]> = [
      ['CONTRATO_HONORARIOS', 'Contrato de honorários'],
      ['PROCURACAO', 'Procuração'],
      ['HIPOSSUFICIENCIA', 'Declaração de hipossuficiência'],
    ];
    for (const [index, [category, label]] of requiredDocuments.entries()) {
      await documentGenerator.getByLabel('Documento para gerar').selectOption(category);
      const generateButton = documentGenerator.getByRole('button', { name: /^Gerar / });
      await generateButton.click();
      await expect(page.getByText(/gerado e salvo no histórico do cliente\./)).toBeVisible();
      if (index < requiredDocuments.length - 1) {
        const checklistItem = page.locator('.document-check-item').filter({ hasText: label });
        await expect(checklistItem.getByText(label, { exact: true })).toBeVisible();
        await expect(checklistItem.getByText('1 modelo gerado')).toBeVisible();
      }
    }
    await expect(page.getByRole('heading', { name: 'Fluxo inicial concluído' })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir ficha completa' }).click();
    await expect(page.getByRole('heading', { name: 'Cobrar pelo WhatsApp' })).toBeVisible();
    const whatsapp = page.getByRole('link', { name: 'Abrir conversa no WhatsApp' });
    await expect(whatsapp).toHaveAttribute('href', /wa\.me\/5598999991234\?text=/);
    await expect(whatsapp).toHaveAttribute('href', /1\.078%2C25/);
    await page.getByLabel('Selecionar foto do cliente').setInputFiles({
      name: 'cliente.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.getByAltText('Foto de Cliente QA')).toBeVisible();
    await page.getByRole('button', { name: 'Remover foto' }).click();
    await expect(page.getByAltText('Foto de Cliente QA')).toHaveCount(0);
    await page.getByRole('button', { name: 'Novo contrato de honorários' }).click();
    const hearingContractForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Salvar contrato' }),
    });
    await hearingContractForm.getByLabel('Número do contrato').fill('H-2026-002');
    await hearingContractForm.getByLabel('Valor fixo (R$)').fill('800,00');
    await hearingContractForm.getByLabel('Este contrato inclui audiência').check();
    await hearingContractForm.getByLabel('Data e horário').fill('2030-05-21T10:00');
    await hearingContractForm.getByLabel('Local (opcional)').fill('Fórum Central');
    await hearingContractForm.getByLabel('Outro intervalo (minutos)').fill('45');
    await hearingContractForm.getByRole('button', { name: 'Adicionar alerta' }).click();
    await hearingContractForm.getByRole('button', { name: 'Salvar contrato' }).click();
    await expect(page.getByText('Contrato de honorários cadastrado.')).toBeVisible();
    const hearingContractRequest = requests
      .filter((item) => item.path === '/v1/finance/contracts' && item.method === 'POST')
      .at(-1);
    expect(hearingContractRequest?.body).toMatchObject({
      number: 'H-2026-002',
      hearings: [
        {
          location: 'Fórum Central',
          reminderMinutes: [60, 45, 30, 10],
        },
      ],
    });
    expect(hearingContractRequest?.body?.hearings).toMatchObject([
      { startsAt: expect.stringMatching(/^2030-05-21T\d{2}:00:00\.000Z$/) },
    ]);
    await expect(page.getByText('R$ 1.078,25', { exact: true })).toBeVisible();
    for (const [, label] of requiredDocuments) {
      const checklistItem = page.locator('.document-check-item').filter({ hasText: label });
      await expect(checklistItem.getByText('1 modelo gerado')).toBeVisible();
    }
    await expect(
      page.locator('#honorarios-cliente').getByText('H-2026-001 · Honorários — Cliente QA'),
    ).toBeVisible();
    expect(
      requests.filter((item) => item.path === '/v1/documents/generate' && item.method === 'POST'),
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
    if (viewport.width === 360) {
      await page.getByRole('button', { name: 'Voltar à lista' }).click();
      await page.getByRole('button', { name: 'Novo cliente' }).click();
      const personForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Cadastrar e abrir cliente' }),
      });
      await personForm.getByLabel('Nome completo').fill('Cliente com documento QA');
      await personForm.getByLabel('CPF').fill('52998224725');
      await personForm.getByLabel('Escolher foto do documento').setInputFiles({
        name: 'documento-qa.png',
        mimeType: 'image/png',
        buffer: Buffer.from(identityImageData, 'base64'),
      });
      await personForm.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
      await expect(page.getByRole('heading', { name: 'Cliente com documento QA' })).toBeVisible();
      const identityUploads = documentUploads.filter((upload) => upload.includes('IDENTIFICACAO'));
      expect(identityUploads).toHaveLength(2);
      expect(identityUploads[1]).toContain('client-qa');
    }
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>('*'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: String(element.className),
            id: element.id,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .filter((element) => element.width > 0 && element.right > window.innerWidth + 1)
        .slice(0, 10),
    }));
    expect(layout.width, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(viewport.width);
  });
}
