import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`client portal messages and private document at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.open = ((url?: string | URL, target?: string, features?: string) => {
        (window as Window & { openedDocument?: string[] }).openedDocument = [
          String(url),
          target ?? '',
          features ?? '',
        ];
        return null;
      }) as typeof window.open;
    });
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const messages = [
      { id: 'message-1', body: 'Atualização publicada.', publishedAt: '2026-10-20' },
    ];
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const submitted = request.postDataJSON() as Record<string, unknown> | null;
      let body: unknown;
      if (path === '/v1/auth/me') {
        body = {
          user: {
            id: 'qa-client',
            email: 'client@example.test',
            clientId: 'client-1',
            permissions: ['messages:view', 'messages:create', 'documents:view'],
          },
          organization: { name: 'Organização QA' },
        };
      } else if (path === '/v1/client-messages' && method === 'GET') {
        body = messages;
      } else if (path === '/v1/client-messages' && method === 'POST') {
        const message = {
          id: 'message-2',
          body: String(submitted?.body),
          publishedAt: '2026-10-20',
        };
        messages.push(message);
        body = message;
      } else if (path === '/v1/documents' && method === 'GET') {
        body = {
          items: [
            {
              id: 'document-1',
              title: 'Comprovante QA',
              category: 'Comprovante',
              updatedAt: '2026-10-20',
              visibility: 'CLIENT',
              versions: [{ fileName: 'comprovante.pdf' }],
            },
          ],
          total: 1,
        };
      } else if (path === '/v1/documents/document-1/download-url' && method === 'GET') {
        body = { url: 'https://example.test/temporary-document' };
      } else {
        throw new Error(`Unexpected client API request: ${method} ${path}`);
      }
      requests.push({ method, path, body: submitted ?? undefined });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Minha área' })).toBeVisible();
    await expect(page.getByText('Atualização publicada.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Comprovante QA/ })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Navegacao principal' }).getByRole('button'),
    ).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Usuários e permissões' })).toHaveCount(0);
    await page.getByLabel('Responder ao escritório').fill('Mensagem de resposta QA');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.getByText('Mensagem enviada à equipe.')).toBeVisible();
    await expect(page.getByText('Mensagem de resposta QA')).toBeVisible();
    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      clientId: 'client-1',
      body: 'Mensagem de resposta QA',
    });
    await page.getByRole('button', { name: /Comprovante QA/ }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                openedDocument?: string[];
              }
            ).openedDocument,
        ),
      )
      .toEqual(['https://example.test/temporary-document', '_blank', 'noopener,noreferrer']);
    expect(
      requests.some((request) => request.path === '/v1/documents/document-1/download-url'),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
  });
}
