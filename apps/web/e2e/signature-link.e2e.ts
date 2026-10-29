import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`client signs from an expanded touch-friendly link at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await page.setViewportSize(viewport);
    const token = 'a'.repeat(64);
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/v1/public/signatures/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/sign')) {
        submitted = request.postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SIGNED', signedAt: '2026-10-22T12:00:00.000Z' }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'PENDING',
          documentTitle: 'Contrato de honorários · Cliente QA',
          signerName: 'Marina Souza',
          expiresAt: '2027-01-01T12:00:00.000Z',
          sourceVersion: 2,
          sourceSha256: 'b'.repeat(64),
          documentUrl: 'https://documents.example.test/temporary.pdf',
        }),
      });
    });

    await page.goto(`/assinar/${token}`);
    await expect(
      page.getByRole('heading', { name: 'Contrato de honorários · Cliente QA' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Abrir e conferir PDF/ })).toHaveAttribute(
      'href',
      'https://documents.example.test/temporary.pdf',
    );
    await page.getByRole('button', { name: 'Ampliar área' }).click();
    const canvas = page.getByRole('img', { name: 'Área para desenhar a assinatura' });
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds?.height).toBeGreaterThan(250);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (!bounds) throw new Error('Área de assinatura sem dimensões.');
    await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height / 2 - 24, {
      steps: 8,
    });
    await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2 + 10, {
      steps: 8,
    });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Concluir desenho e continuar' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Assinar documento' }).click();
    await expect(page.getByRole('heading', { name: 'Assinatura concluída' })).toBeVisible();
    expect(submitted?.signerName).toBe('Marina Souza');
    expect(submitted?.consent).toBe(true);
    expect(String(submitted?.signature)).toMatch(/^data:image\/png;base64,/);
  });
}
