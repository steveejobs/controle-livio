import { expect, type Locator } from '@playwright/test';

export async function openClientQualification(form: Locator) {
  const birthDate = form.locator('input[name="legalIdentity.birthDate"]');
  const qualification = form.locator('details').filter({
    has: form.page().locator('input[name="legalIdentity.birthDate"]'),
  });
  await expect(qualification).toHaveCount(1);
  if ((await qualification.getAttribute('open')) === null)
    await qualification.locator('summary').click();
  await expect(birthDate).toBeVisible();
}
