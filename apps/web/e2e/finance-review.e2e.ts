import { expect, test } from '@playwright/test';

for (const width of [360, 1440]) {
  for (const admin of [true, false]) {
    test(`payment corrections, decisions and adjustment options admin=${admin} at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
      const client = { id: 'client-qa', displayName: 'Cliente QA' };
      const payment = {
        id: 'payment-qa',
        reference: 'PIX-QA',
        amount: '10.00',
        currency: 'BRL',
        status: 'CONFIRMED',
        paidAt: '2026-10-20T12:00:00.000Z',
        method: 'PIX',
        client,
        allocations: [
          {
            installmentId: 'part-qa',
            amount: '10.00',
            installment: { sequence: 1, receivable: { reference: 'REC-QA' } },
          },
        ],
      };
      const change = {
        id: 'change-qa',
        status: 'PENDING',
        reason: 'Correção QA',
        createdAt: payment.paidAt,
        requestedByName: 'Financeiro QA',
        proposedData: { ...payment, allocations: [] },
        payment,
      };
      let changes = [change];
      await page.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        let body: unknown;
        if (path === '/v1/auth/me')
          body = {
            user: {
              id: 'qa-user',
              email: 'qa@example.test',
              isAdministrator: admin,
              permissions: [
                'receivables:view',
                'receivables:approve',
                'payments:view',
                'payments:update',
                'payments:approve',
              ],
            },
            organization: { name: 'QA' },
          };
        else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
        else if (req.method() !== 'GET') {
          const submitted = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : {};
          writes.push({ path, body: submitted });
          if (path.endsWith('/reversal')) payment.status = 'REVERSED';
          if (path.endsWith('/change-qa/reject')) changes = [{ ...change, id: 'approval-qa' }];
          if (path.endsWith('/approval-qa/approve')) changes = [];
          body = { id: 'result-qa' };
        } else if (path === '/v1/finance/receivables')
          body = {
            items: [
              {
                id: 'rec-qa',
                clientId: client.id,
                client,
                reference: 'REC-QA',
                description: 'Recebível QA',
                originalAmount: '100.00',
                currency: 'BRL',
                status: 'OPEN',
                dueDate: '2026-11-30',
                installments: [
                  {
                    id: 'part-qa',
                    sequence: 1,
                    amount: '100.00',
                    dueDate: '2026-11-30',
                    status: 'OPEN',
                    allocations: [],
                  },
                ],
              },
            ],
            total: 1,
          };
        else if (path === '/v1/finance/payments') body = { items: [payment], total: 1 };
        else if (path === '/v1/finance/payments/change-requests')
          body = { items: changes, total: changes.length };
        else throw new Error(`Unexpected GET ${path}`);
        await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Entradas, parcelas e pagamentos' }),
      ).toBeVisible();
      for (const kind of ['DISCOUNT', 'INTEREST', 'PENALTY', 'CORRECTION', 'OTHER']) {
        await page.getByRole('button', { name: 'Ajustar parcela 1', exact: true }).click();
        const form = page
          .locator('form')
          .filter({ has: page.getByRole('button', { name: 'Aplicar', exact: true }) });
        await form.getByRole('combobox', { name: 'Tipo', exact: true }).selectOption(kind);
        await form.getByLabel('Valor', { exact: true }).fill('1,25');
        await form.getByLabel('Motivo', { exact: true }).fill('Ajuste QA');
        await form.getByRole('button', { name: 'Aplicar', exact: true }).click();
        await expect(page.getByText('Ajuste financeiro aplicado.', { exact: true })).toBeVisible();
        expect(writes.at(-1)).toMatchObject({
          path: '/v1/finance/installments/part-qa/adjustments',
          body: { kind, amount: '1.25' },
        });
      }
      await page.getByRole('heading', { name: 'Pagamentos recebidos' }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Corrigir dados' }).click();
      const edit = page.locator('.payment-edit-form');
      await edit.getByLabel('Referência', { exact: true }).fill('PIX-QA-CORRIGIDO');
      await edit.getByLabel('Motivo da correção').fill('Referência corrigida QA');
      await edit
        .getByRole('button', { name: admin ? 'Aplicar correção' : 'Enviar para aprovação' })
        .click();
      await expect(
        page.getByText(
          admin
            ? 'Pagamento corrigido com registro de estorno e substituição.'
            : 'Correção enviada ao Administrador para aprovação.',
          { exact: true },
        ),
      ).toBeVisible();
      expect(writes.at(-1)).toMatchObject({
        path: '/v1/finance/payments/payment-qa/change-requests',
        body: {
          reference: 'PIX-QA-CORRIGIDO',
          amount: '10.00',
          allocations: [{ installmentId: 'part-qa', amount: '10.00' }],
        },
      });
      if (!admin) {
        await expect(page.getByRole('button', { name: 'Estornar', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Aprovar e corrigir' })).toHaveCount(0);
        return;
      }
      await page
        .getByRole('heading', { name: 'Correções de pagamento pendentes' })
        .scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Recusar', exact: true }).click();
      await expect(page.getByText('Solicitação recusada.', { exact: true })).toBeVisible();
      expect(writes.at(-1)).toMatchObject({
        path: '/v1/finance/payments/change-requests/change-qa/reject',
        body: { note: 'Recusado pelo Administrador.' },
      });
      await page.getByRole('button', { name: 'Aprovar e corrigir', exact: true }).click();
      await expect(page.getByText('Correção aprovada e aplicada.', { exact: true })).toBeVisible();
      expect(writes.at(-1)?.path).toBe('/v1/finance/payments/change-requests/approval-qa/approve');
      await page.getByRole('heading', { name: 'Pagamentos recebidos' }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Estornar', exact: true }).click();
      const reversal = page
        .locator('form')
        .filter({ has: page.getByRole('button', { name: 'Confirmar estorno' }) });
      await reversal.getByLabel('Motivo', { exact: true }).fill('Estorno QA');
      await reversal.getByRole('button', { name: 'Confirmar estorno' }).click();
      await expect(page.getByText('Pagamento estornado.', { exact: true })).toBeVisible();
      expect(writes.at(-1)).toMatchObject({
        path: '/v1/finance/payments/payment-qa/reversal',
        body: { reason: 'Estorno QA' },
      });
    });
  }
}
