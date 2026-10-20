import { expect, test } from '@playwright/test';

test('login password can be shown and hidden with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ message: 'Unauthorized' }),
    }),
  );
  await page.goto('/');

  const password = page.getByLabel('Senha', { exact: true });
  const show = page.getByRole('button', { name: 'Mostrar senha' });
  await expect(password).toHaveAttribute('type', 'password');
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('new password and confirmation each toggle, with six-character minimum', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/reset-password');

  const password = page.getByLabel('Nova senha', { exact: true });
  const confirmation = page.getByLabel('Confirme a nova senha', { exact: true });
  await expect(password).toHaveAttribute('minlength', '6');
  await expect(confirmation).toHaveAttribute('minlength', '6');
  await password.fill('abcde');
  expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await password.fill('abcdef');
  expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);

  await page.getByRole('button', { name: 'Mostrar nova senha' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(confirmation).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Ocultar nova senha' }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Mostrar confirmação da nova senha' }).click();
  await expect(confirmation).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ocultar confirmação da nova senha' }).click();
  await expect(confirmation).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
