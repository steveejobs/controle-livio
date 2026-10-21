import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = {
  data?: { json: () => unknown; text: () => string };
  notification?: { close: () => void; data?: { url?: string } };
  waitUntil: (promise: Promise<unknown>) => void;
};
type WorkerListener = (event: WorkerEvent) => void;

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function createServiceWorkerHarness() {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const client = {
    url: 'https://livio.example/',
    focus: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  };
  const self = {
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    registration: { showNotification },
    location: { origin: 'https://livio.example' },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([client]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
  };
  runInNewContext(source, { self, URL, Promise });
  return { listeners, self, client, showNotification };
}

describe('service worker notifications', () => {
  it('shows a system notification when a push event arrives', async () => {
    const { listeners, showNotification } = createServiceWorkerHarness();
    const push = listeners.get('push');
    expect(push).toBeDefined();
    let completion: Promise<unknown> = Promise.resolve();

    push!({
      data: {
        json: () => ({ title: 'Novo alerta financeiro', body: 'Abra o Lívio para conferir.' }),
        text: () => '',
      },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    await completion;

    expect(showNotification).toHaveBeenCalledWith(
      'Novo alerta financeiro',
      expect.objectContaining({
        body: 'Abra o Lívio para conferir.',
        icon: '/icons/icon-192.png',
        data: { url: '/' },
      }),
    );
  });

  it('focuses the app on click and rejects navigation to another origin', async () => {
    const { listeners, client } = createServiceWorkerHarness();
    const click = listeners.get('notificationclick');
    expect(click).toBeDefined();
    const navigate = async (url: string) => {
      let completion: Promise<unknown> = Promise.resolve();
      click!({
        notification: { close: vi.fn(), data: { url } },
        waitUntil: (promise) => {
          completion = promise;
        },
      });
      await completion;
    };

    await navigate('/notifications');
    await navigate('https://attacker.example/');

    expect(client.focus).toHaveBeenCalledTimes(2);
    expect(client.navigate).toHaveBeenNthCalledWith(1, 'https://livio.example/notifications');
    expect(client.navigate).toHaveBeenNthCalledWith(2, 'https://livio.example');
  });
});
