import { expect, test } from '@playwright/test';

const client = { id: 'client-qa', displayName: 'Cliente QA' };
const installmentId = 'part-qa';

function receipt(
  id: string,
  amount: string,
  warning = false,
  paidDate = '2026-10-29',
  method = 'PIX',
) {
  return {
    id,
    status: 'PENDING_REVIEW',
    clientId: client.id,
    installmentId,
    documentId: `document-${id}`,
    document: { id: `document-${id}`, title: `Comprovante ${id}` },
    extractedFields: {
      paidAmount: { value: amount, source: 'PDF_TEXT', confidence: 1 },
      paidDate: { value: paidDate, source: 'PDF_TEXT', confidence: 1 },
      beneficiary: { value: `Beneficiário ${id}`, source: 'PDF_TEXT', confidence: 1 },
      documentType: { value: method, source: 'PDF_TEXT', confidence: 1 },
    },
    reconciliation: {
      originalAmount: '100.00',
      previousPaid: '0.00',
      balanceBefore: '100.00',
      paidAmount: amount,
      expectedAmount: amount,
      difference: '0.00',
      balanceAfter: warning ? '75.00' : '66.66',
      dueDate: '2026-11-15',
      paidDate,
      outcome: 'PARTIAL',
      timing: 'EARLY',
      warnings: warning ? ['Operação não liquidada ou devolvida.'] : [],
    },
  };
}

for (const width of [360, 1440]) {
  test(`receipt identity follows a new upload at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const receiptA = receipt('receipt-a', '25.00', true, '2026-10-28', 'BOLETO');
    const receiptB = receipt('receipt-b', '33.34');
    const receiptC = receipt('receipt-c', '44.44');
    const receiptD = receipt('receipt-d', '55.55');
    const receiptE = receipt('receipt-e', '66.66');
    const receiptF = receipt('receipt-f', '77.77');
    const uploaded = [receiptA, receiptB, receiptC];
    const confirmations: string[] = [];
    let failUpload = false;
    let showQueue = false;
    let raceMode = false;
    let releaseSlowUpload: (() => void) | undefined;
    const slowUploadGate = new Promise<void>((resolve) => {
      releaseSlowUpload = resolve;
    });
    let holdConfirmation = false;
    let releaseConfirmation: (() => void) | undefined;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let status = 200;
      let body: unknown;
      if (path === '/v1/auth/me')
        body = {
          user: {
            id: 'qa-finance',
            email: 'qa@example.test',
            permissions: [
              'clients:view',
              'receivables:view',
              'payments:create',
              'payments:view',
              'receipts:create',
              'receipts:approve',
            ],
          },
          organization: { name: 'QA' },
        };
      else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
      else if (path === '/v1/clients') body = { items: [client], total: 1 };
      else if (path === '/v1/finance/receivables')
        body = {
          items: [
            {
              id: 'receivable-qa',
              clientId: client.id,
              client,
              reference: 'REC-QA',
              description: 'Cobrança sintética',
              originalAmount: '100.00',
              currency: 'BRL',
              status: 'OPEN',
              dueDate: '2026-11-15',
              installments: [
                {
                  id: installmentId,
                  sequence: 1,
                  amount: '100.00',
                  dueDate: '2026-11-15',
                  status: 'OPEN',
                  allocations: [],
                },
              ],
            },
          ],
          total: 1,
        };
      else if (path === '/v1/finance/payments') body = { items: [], total: 0 };
      else if (path === '/v1/finance/receipts' && request.method() === 'GET')
        body = showQueue ? { items: [receiptA, receiptC], total: 2 } : { items: [], total: 0 };
      else if (path === '/v1/finance/receipts' && request.method() === 'POST') {
        if (raceMode) {
          const payload = request.postData() ?? '';
          status = 201;
          if (payload.includes('slow.pdf')) {
            await slowUploadGate;
            body = receiptD;
          } else if (payload.includes('fast.pdf')) body = receiptE;
          else throw new Error('Unexpected racing receipt upload');
        } else if (failUpload) {
          status = 503;
          body = { message: 'Falha sintética no upload' };
        } else {
          status = 201;
          body = uploaded.shift();
          if (!body) throw new Error('Unexpected receipt upload');
        }
      } else if (/^\/v1\/finance\/receipts\/[^/]+\/confirm$/.test(path)) {
        confirmations.push(path);
        if (holdConfirmation && path.includes('receipt-e')) await confirmationGate;
        status = path.includes('receipt-a') ? 400 : 201;
        body =
          status === 400
            ? { message: 'Operação não liquidada ou devolvida' }
            : { id: 'payment-qa' };
      } else body = { items: [], total: 0 };
      await route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } });
    });

    await page.goto('/');
    if (width <= 900) await page.getByRole('button', { name: 'Abrir navegação' }).click();
    await page.locator('#primary-navigation').getByRole('button', { name: 'Recebíveis' }).click();
    await page.getByRole('button', { name: 'Receber pagamento' }).click();
    const paymentForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Confirmar pagamento', exact: true }),
    });
    await paymentForm.locator('select').first().selectOption(client.id);
    await paymentForm.locator('select[name="installmentId"]').selectOption(installmentId);
    const uploadForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Enviar e conferir comprovante' }),
    });
    const upload = async (name: string) => {
      await uploadForm.getByLabel('Anexar comprovante e identificar pagamento').setInputFiles({
        name,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 synthetic'),
      });
      await uploadForm.getByRole('button', { name: 'Enviar e conferir comprovante' }).click();
    };
    const preview = page.getByRole('region', { name: 'Conferência do comprovante' });
    await upload('a.pdf');
    await expect(preview).toContainText('R$ 25,00');
    await preview.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect(preview.getByRole('status')).toContainText('Operação não liquidada ou devolvida');
    expect(confirmations).toEqual(['/v1/finance/receipts/receipt-a/confirm']);
    await upload('b.pdf');
    await expect(preview).toContainText('Comprovante receipt-b');
    await expect(preview).toContainText('R$ 33,34');
    await expect(preview).toContainText('Beneficiário receipt-b');
    await expect(preview).not.toContainText('Beneficiário receipt-a');
    await expect(preview.getByLabel('Data e hora conferidas')).toHaveValue('2026-10-29T12:00');
    await expect(preview.getByLabel('Forma de pagamento')).toHaveValue('PIX');
    await expect(preview.getByRole('status')).toHaveCount(0);
    await preview.getByLabel('Valor conferido').fill('34.00');
    await uploadForm.getByLabel('Anexar comprovante e identificar pagamento').setInputFiles({
      name: 'b-preview.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic'),
    });
    await expect(preview.getByLabel('Valor conferido')).toHaveValue('34.00');
    await preview.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect
      .poll(() => confirmations)
      .toEqual([
        '/v1/finance/receipts/receipt-a/confirm',
        '/v1/finance/receipts/receipt-b/confirm',
      ]);
    failUpload = true;
    await upload('c.pdf');
    await expect(preview).toHaveCount(0);
    await expect(page.getByText('Erro: Falha sintética no upload')).toBeVisible();
    failUpload = false;
    await upload('c.pdf');
    await expect(preview).toContainText('Comprovante receipt-c');
    await expect(preview).toContainText('R$ 44,44');
    raceMode = true;
    const slowResponse = page.waitForResponse((response) =>
      Boolean(response.request().postData()?.includes('slow.pdf')),
    );
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[name="file"]');
      const form = input?.closest('form');
      if (!input || !form) throw new Error('Receipt upload form missing');
      for (const name of ['slow.pdf', 'fast.pdf']) {
        input.disabled = false;
        const files = new DataTransfer();
        files.items.add(new File(['synthetic PDF'], name, { type: 'application/pdf' }));
        input.files = files.files;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
    try {
      await expect(preview).toContainText('Comprovante receipt-e');
      releaseSlowUpload?.();
      await slowResponse;
      await expect(preview).toContainText('Comprovante receipt-e');
      await expect(preview).not.toContainText('Comprovante receipt-d');
    } finally {
      releaseSlowUpload?.();
    }
    raceMode = false;
    uploaded.push(receiptF);
    holdConfirmation = true;
    const oldConfirmation = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/receipt-e/confirm'),
    );
    await preview.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect.poll(() => confirmations).toContain('/v1/finance/receipts/receipt-e/confirm');
    try {
      await upload('f.pdf');
      await expect(preview).toContainText('Comprovante receipt-f');
      releaseConfirmation?.();
      await oldConfirmation;
      await expect(preview).toContainText('Comprovante receipt-f');
      await expect(preview).not.toContainText('Comprovante receipt-e');
    } finally {
      releaseConfirmation?.();
    }
    uploaded.push({
      ...receipt('receipt-g', '88.88'),
      document: { id: 'wrong-document', title: 'Comprovante incompatível' },
    });
    await upload('g-invalid.pdf');
    await expect(preview).toHaveCount(0);
    await expect(
      page.getByText('Erro: O comprovante recebido não corresponde ao lançamento selecionado.'),
    ).toBeVisible();
    uploaded.push(receipt('receipt-g', '88.88'));
    await upload('g-valid.pdf');
    await expect(preview).toContainText('Comprovante receipt-g');
    await uploadForm.getByLabel('Anexar comprovante e identificar pagamento').setInputFiles([]);
    expect(await uploadForm.evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(
      false,
    );
    await expect(preview).toContainText('Comprovante receipt-g');
    showQueue = true;
    await page.reload();
    if (width <= 900) await page.getByRole('button', { name: 'Abrir navegação' }).click();
    await page.locator('#primary-navigation').getByRole('button', { name: 'Recebíveis' }).click();
    const queue = page.getByRole('region', { name: 'Comprovantes aguardando conferência' });
    await expect(queue.getByRole('heading', { name: 'Comprovante receipt-a' })).toBeVisible();
    await expect(queue.getByRole('heading', { name: 'Comprovante receipt-c' })).toBeVisible();
  });
}
