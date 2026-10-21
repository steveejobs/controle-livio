(() => {
  if (window.__livioPwaInstall) return;

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);
  window.__livioPwaInstall = {
    state: { available: false, installed: standalone },
    prompt: undefined,
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__livioPwaInstall.prompt = event;
    window.__livioPwaInstall.state = { ...window.__livioPwaInstall.state, available: true };
    window.dispatchEvent(new Event('livio-pwa-install-change'));
  });

  window.addEventListener('appinstalled', () => {
    window.__livioPwaInstall.prompt = undefined;
    window.__livioPwaInstall.state = { available: false, installed: true };
    window.dispatchEvent(new Event('livio-pwa-install-change'));
  });
})();
