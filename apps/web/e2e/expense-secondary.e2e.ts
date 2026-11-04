import { expect, test } from '@playwright/test';

for (const width of [360, 1440]) {
  test(`expense policy, filters, history, editing, rejection and cancellation at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const queries: URLSearchParams[] = [];
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    const expenses = [
      { id: 'draft-qa', description: 'Despesa rascunho', status: 'DRAFT' },
      { id: 'pending-qa', description: 'Despesa pendente', status: 'PENDING_APPROVAL' },
    ].map((item) => ({
      ...item,
      category: 'Custas',
      amount: '10.00',
      currency: 'BRL',
      incurredAt: '2026-11-01',
      dueDate: '2026-11-20',
      reimbursable: false,
      documents: [],
    }));
    let required = true;
    await page.route('**/v1/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = url.pathname;
      let body: unknown;
      if (path === '/v1/auth/me')
        body = {
          user: {
            id: 'qa-admin',
            email: 'qa@example.test',
            isAdministrator: true,
            permissions: [
              'receivables:view',
              'expenses:view',
              'expenses:update',
              'expenses:approve',
              'organization:update',
            ],
          },
          organization: { name: 'QA' },
        };
      else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
      else if (request.method() !== 'GET') {
        const input = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
        writes.push({ path, body: input });
        if (path.endsWith('/approval-policy')) required = Boolean(input.required);
        if (path.endsWith('/draft-qa')) Object.assign(expenses[0]!, input);
        if (path.endsWith('/draft-qa/cancel')) expenses[0]!.status = 'CANCELLED';
        if (path.endsWith('/pending-qa/reject')) expenses[1]!.status = 'REJECTED';
        body = { required, canSubmitForApproval: true };
      } else if (path === '/v1/finance/expenses/approval-policy')
        body = { required, canSubmitForApproval: true };
      else if (path === '/v1/finance/expenses/summary') body = { currencies: [] };
      else if (path === '/v1/finance/expenses/responsibles') body = [];
      else if (path.endsWith('/history')) body = { items: [], total: 0 };
      else if (path === '/v1/finance/expenses') {
        queries.push(url.searchParams);
        const items = expenses.filter(
          (item) =>
            !url.searchParams.get('status') || item.status === url.searchParams.get('status'),
        );
        body = { items, total: items.length };
      } else if (path === '/v1/finance/receivables') body = { items: [], total: 0 };
      else throw new Error(`Unexpected ${path}`);
      await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/');
    await page.getByRole('heading', { name: 'Despesas', exact: true }).scrollIntoViewIfNeeded();
    const policy = page.getByRole('combobox', { name: 'Aprovação obrigatória' });
    await expect(policy).toBeEnabled();
    for (const value of ['no', 'yes']) {
      await policy.selectOption(value);
      await page.getByRole('button', { name: 'Salvar política' }).click();
      await expect(
        page.getByText('Política de aprovação atualizada.', { exact: true }),
      ).toBeVisible();
      expect(writes.at(-1)).toMatchObject({ body: { required: value === 'yes' } });
    }
    const filters = page.locator('.expense-filters');
    for (const status of [
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'PAID',
      'CANCELLED',
    ]) {
      await filters.getByRole('combobox', { name: 'Status', exact: true }).selectOption(status);
      await expect.poll(() => queries.some((query) => query.get('status') === status)).toBe(true);
    }
    await filters.getByRole('combobox', { name: 'Status', exact: true }).selectOption('');
    for (const period of ['incurredAt', 'paidAt', 'dueDate']) {
      await filters.getByRole('combobox', { name: 'Filtrar data por' }).selectOption(period);
      await expect.poll(() => queries.some((query) => query.get('period') === period)).toBe(true);
    }
    await filters.getByLabel('Categoria', { exact: true }).fill('Custas');
    await filters.getByLabel('De', { exact: true }).fill('2026-11-01');
    await filters.getByLabel('Até', { exact: true }).fill('2026-11-30');
    await expect
      .poll(() =>
        queries.some(
          (query) =>
            query.get('category') === 'Custas' &&
            query.get('from') === '2026-11-01' &&
            query.get('to') === '2026-11-30',
        ),
      )
      .toBe(true);
    const draft = page.getByRole('row').filter({ hasText: 'Despesa rascunho' });
    await draft.getByRole('button', { name: 'Histórico', exact: true }).click();
    await expect(page.getByText('Nenhuma alteração registrada.', { exact: true })).toBeVisible();
    await draft.getByRole('button', { name: 'Fechar histórico' }).click();
    await draft.getByRole('button', { name: 'Editar', exact: true }).click();
    const edit = page.locator('.expense-edit-form');
    await edit.getByLabel('Descrição', { exact: true }).fill('Despesa editada QA');
    await edit.getByLabel('Valor', { exact: true }).fill('12,50');
    await edit.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
    await expect(
      page.getByText('Despesa atualizada. A trilha de auditoria foi registrada.', { exact: true }),
    ).toBeVisible();
    expect(writes.at(-1)).toMatchObject({
      path: '/v1/finance/expenses/draft-qa',
      body: { amount: '12.50', description: 'Despesa editada QA' },
    });
    await page
      .getByRole('row')
      .filter({ hasText: 'Despesa editada QA' })
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click();
    await expect(
      page.getByText('Despesa cancelada e registrada no histórico.', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('row')
      .filter({ hasText: 'Despesa pendente' })
      .getByRole('button', { name: 'Rejeitar', exact: true })
      .click();
    await page.getByLabel('Motivo da rejeição').fill('Justificativa de teste QA');
    await page.getByRole('button', { name: 'Registrar rejeição', exact: true }).click();
    await expect(
      page.getByText('Despesa rejeitada com justificativa.', { exact: true }),
    ).toBeVisible();
    expect(writes.at(-1)).toMatchObject({
      path: '/v1/finance/expenses/pending-qa/reject',
      body: { reason: 'Justificativa de teste QA' },
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
