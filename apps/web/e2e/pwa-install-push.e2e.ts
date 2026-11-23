import { expect, test } from '@playwright/test';

test('the install prompt is retained and the service worker is served', async ({ page }) => {
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Sessão ausente' }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();

  await page.evaluate(() => {
    const installWindow = window as Window & { __installPromptCalled?: boolean };
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        installWindow.__installPromptCalled = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    window.dispatchEvent(event);
  });
  const installButton = page.getByRole('button', { name: 'Instalar aplicativo' });
  await expect(installButton).toBeVisible();
  await installButton.click();
  await expect(page.getByRole('button', { name: 'Como abrir o aplicativo' })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __installPromptCalled?: boolean }).__installPromptCalled,
    ),
  ).toBe(true);

  const serviceWorker = await page.request.get('/sw.js');
  expect(serviceWorker.ok()).toBe(true);
  expect(await serviceWorker.text()).toContain('showNotification');
});

test('push alerts can be enabled and disabled for this browser', async ({ page }) => {
  await page.addInitScript(() => {
    let currentSubscription: {
      endpoint: string;
      toJSON: () => Record<string, unknown>;
      unsubscribe: () => Promise<boolean>;
    } | null = null;
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/browser-test',
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/browser-test',
        expirationTime: null,
        keys: {
          p256dh: 'abcdefghijklmnopqrstuvwxyz123456',
          auth: 'abcdefghijklmnopqrstuvwxyz123456',
        },
      }),
      unsubscribe: async () => {
        currentSubscription = null;
        return true;
      },
    };
    const registration = {
      pushManager: {
        getSubscription: async () => currentSubscription,
        subscribe: async () => {
          currentSubscription = subscription;
          return subscription;
        },
      },
    };
    const notificationShim = {
      permission: 'default',
      requestPermission: async () => {
        notificationShim.permission = 'granted';
        return 'granted';
      },
    };
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: notificationShim,
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
  });

  const requests: string[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    let body: unknown = {};
    if (pathname === '/v1/audit-logs/module-views' && method === 'POST') {
      body = { recorded: true };
    } else if (pathname === '/v1/auth/me') {
      body = {
        user: {
          id: 'push-qa-user',
          email: 'push-qa@example.test',
          name: 'QA',
          permissions: ['reports:view', 'notifications:view', 'notifications:update'],
        },
        organization: { name: 'Organização QA' },
      };
    } else if (pathname === '/v1/dashboard/summary') {
      body = {
        activeClients: 0,
        activeMatters: 0,
        overdueReceivables: 0,
        openTasks: 0,
        monthlyReceivables: [],
      };
    } else if (pathname === '/v1/notifications') {
      body = { items: [], unread: 0 };
    } else if (pathname === '/v1/notifications/reconcile') {
      body = { active: 0, overdue: 0, taskReminders: 0 };
    } else if (pathname === '/v1/notifications/push/config') {
      body = {
        enabled: true,
        publicKey: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
        subscriptions: [],
      };
    } else if (
      pathname === '/v1/notifications/push-subscriptions' &&
      (method === 'POST' || method === 'DELETE')
    ) {
      requests.push(method);
      body = { enabled: method === 'POST' };
    } else {
      body = {};
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  const notificationsTab = page
    .locator('#primary-navigation')
    .getByRole('button', { name: 'Notificações', exact: true });
  await expect(notificationsTab).toBeVisible();
  await notificationsTab.click();
  await expect(page.getByRole('heading', { name: 'Notificações do Lívio' })).toBeVisible();
  await page.getByRole('button', { name: 'Ativar notificações neste dispositivo' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Ativas neste dispositivo.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Desativar neste dispositivo' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'As notificações foram desativadas neste dispositivo.' }),
  ).toBeVisible();
  expect(requests).toEqual(['POST', 'DELETE']);
});
