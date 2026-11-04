import { expect, test } from '@playwright/test';

for (const width of [360, 1440]) {
  test(`receipt review decisions, cancellation and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: Array<{ id: string; action: string; body: Record<string, unknown> }> = [];
    let confirmationAttempts = 0;
    let pending = ['correction', 'rejection', 'confirmation'];
    const receipt = (id: string) => ({
      id,
      status: 'PENDING_REVIEW',
      documentId: `document-${id}`,
      document: { id: `document-${id}`, title: `Comprovante ${id}` },
      extractedFields: { paidAmount: { value: '10.00', source: 'OCR', confidence: 0.8 } },
      reconciliation: {
        originalAmount: '100.00',
        previousPaid: '0.00',
        balanceBefore: '100.00',
        paidAmount: '10.00',
        expectedAmount: '10.00',
        difference: '0.00',
        balanceAfter: '90.00',
        dueDate: '2026-11-20',
        paidDate: '2026-11-01',
        outcome: 'PARTIAL',
        timing: 'EARLY',
        warnings: [],
      },
    });
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let status = 200;
      let body: unknown;
      if (path === '/v1/auth/me')
        body = {
          user: {
            id: 'qa-reviewer',
            email: 'qa@example.test',
            permissions: ['receivables:view', 'receipts:approve'],
          },
          organization: { name: 'QA' },
        };
      else if (path === '/v1/audit-logs/module-views') body = { recorded: true };
      else if (path === '/v1/finance/receipts')
        body = { items: pending.map(receipt), total: pending.length };
      else if (path === '/v1/finance/receivables') body = { items: [], total: 0 };
      else {
        const match = path.match(/^\/v1\/finance\/receipts\/([^/]+)\/(decision|confirm)$/);
        if (!match) throw new Error(`Unexpected path ${path}`);
        const id = match[1]!;
        const action = match[2]!;
        writes.push({ id, action, body: request.postDataJSON() as Record<string, unknown> });
        if (action === 'confirm' && confirmationAttempts++ === 0) {
          status = 409;
          body = { message: 'Saldo alterado; confira novamente.' };
        } else {
          pending = pending.filter((value) => value !== id);
          body = { id };
        }
      }
      await route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/');
    const correction = page
      .getByRole('region', { name: 'Conferência do comprovante', exact: true })
      .filter({ has: page.getByRole('heading', { name: 'Comprovante correction' }) });
    await expect(correction).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await correction.getByRole('button', { name: 'Solicitar correção' }).click();
    expect(writes).toHaveLength(0);
    page.once('dialog', (dialog) => dialog.accept('Corrigir valor identificado'));
    await correction.getByRole('button', { name: 'Solicitar correção' }).click();
    await expect(correction).toHaveCount(0);
    expect(writes.at(-1)).toMatchObject({
      id: 'correction',
      body: { decision: 'NEEDS_CORRECTION', reason: 'Corrigir valor identificado' },
    });
    const rejection = page
      .getByRole('region', { name: 'Conferência do comprovante', exact: true })
      .filter({ has: page.getByRole('heading', { name: 'Comprovante rejection' }) });
    page.once('dialog', (dialog) => dialog.accept('Documento de outro pagamento'));
    await rejection.getByRole('button', { name: 'Rejeitar', exact: true }).click();
    await expect(rejection).toHaveCount(0);
    expect(writes.at(-1)).toMatchObject({ id: 'rejection', body: { decision: 'REJECTED' } });
    const confirmation = page
      .getByRole('region', { name: 'Conferência do comprovante', exact: true })
      .filter({ has: page.getByRole('heading', { name: 'Comprovante confirmation' }) });
    await confirmation.getByLabel('Valor conferido').fill('12,50');
    await confirmation.getByLabel('Motivo de correção').fill('Valor conferido no arquivo');
    await confirmation.getByRole('button', { name: 'Confirmar pagamento', exact: true }).click();
    await expect(confirmation.getByRole('status')).toContainText('Saldo alterado');
    await confirmation.getByRole('button', { name: 'Confirmar pagamento', exact: true }).click();
    await expect(page.getByText('Nenhum comprovante pendente.', { exact: true })).toBeVisible();
    expect(writes.at(-1)).toMatchObject({
      id: 'confirmation',
      body: { amount: '12.50', correctionReason: 'Valor conferido no arquivo' },
    });
    expect(confirmationAttempts).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
