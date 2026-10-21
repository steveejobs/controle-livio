self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {
    message = { body: event.data?.text() };
  }

  const title = typeof message.title === 'string' ? message.title : 'Lívio';
  const body =
    typeof message.body === 'string'
      ? message.body
      : 'Você tem uma nova notificação. Abra o Lívio para ver.';
  const url = typeof message.url === 'string' ? message.url : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: typeof message.tag === 'string' ? message.tag : 'livio-notification',
      data: { url },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url;
  const targetUrl = new URL(
    typeof requestedUrl === 'string' ? requestedUrl : '/',
    self.location.origin,
  );
  const safeTarget =
    targetUrl.origin === self.location.origin ? targetUrl.href : self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        void existing.focus();
        if ('navigate' in existing) return existing.navigate(safeTarget);
        return undefined;
      }
      return self.clients.openWindow(safeTarget);
    }),
  );
});
