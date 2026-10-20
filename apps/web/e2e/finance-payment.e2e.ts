import { expect, test } from '@playwright/test';

test('payment form finds a client installment and submits the exact decimal amount', async ({
  page,
}) => {
  let payment: { amount?: string; installmentId?: string; idempotencyKey?: string } = {};
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { 'access-control-allow-origin': '*' };
    let body: unknown;
    if (url.pathname === '/v1/auth/me') {
      body = {
        user: {
          id: 'finance-admin',
          email: 'qa@example.test',
          permissions: [
            'reports:view',
            'clients:view',
            'receivables:view',
            'receivables:create',
            'payments:view',
            'payments:create',
          ],
        },
        organization: { name: 'Organização QA' },
      };
    } else if (url.pathname === '/v1/dashboard/summary') {
      body = {
        activeClients: 1,
        activeMatters: 0,
        overdueReceivables: 0,
        openTasks: 0,
        monthlyReceivables: [],
      };
    } else if (url.pathname === '/v1/clients') {
      body = { total: 1, items: [{ id: 'client-1', displayName: 'Cliente QA' }] };
    } else if (url.pathname === '/v1/finance/receivables') {
      body = url.searchParams.has('clientId')
        ? {
            total: 1,
            items: [
              {
                id: 'receivable-1',
                clientId: 'client-1',
                reference: 'COB-1',
                description: 'Cobrança QA',
                originalAmount: '100.00',
                currency: 'BRL',
                status: 'OPEN',
                dueDate: '2026-10-30T12:00:00Z',
                client: { id: 'client-1', displayName: 'Cliente QA' },
                installments: [
                  {
                    id: 'installment-1',
                    sequence: 1,
                    amount: '100.00',
                    dueDate: '2026-10-30T12:00:00Z',
                    status: 'OPEN',
                    allocations: [],
                  },
                ],
              },
            ],
          }
        : { total: 0, items: [] };
    } else if (url.pathname === '/v1/finance/payments' && request.method() === 'GET') {
      body = { total: 0, items: [] };
    } else if (url.pathname === '/v1/finance/payments' && request.method() === 'POST') {
      const submitted = request.postDataJSON() as {
        amount: string;
        allocations: Array<{ installmentId: string }>;
      };
      payment = {
        amount: submitted.amount,
        installmentId: submitted.allocations[0]?.installmentId,
        idempotencyKey: request.headers()['idempotency-key'],
      };
      body = { id: 'payment-1' };
    } else {
      throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`);
    }
    await route.fulfill({
      status: request.method() === 'POST' ? 201 : 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Recebíveis' }).click();
  await page.getByRole('button', { name: 'Receber pagamento' }).click();
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('client-1');
  await expect(page.getByRole('option', { name: /COB-1.*parcela 1/ })).toBeAttached();
  await page.getByLabel('Parcela').selectOption('installment-1');
  await page.getByLabel('Referência do pagamento').fill('PIX-QA-1');
  await page.getByLabel('Valor recebido').fill('10,00');
  await page.getByLabel('Data do pagamento').fill('2026-10-20T12:00');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByRole('status')).toContainText('Pagamento confirmado');
  expect(payment.amount).toBe('10.00');
  expect(payment.installmentId).toBe('installment-1');
  expect(payment.idempotencyKey).toBeTruthy();
});
