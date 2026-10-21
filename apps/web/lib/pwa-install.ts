import { useSyncExternalStore } from 'react';

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type PwaSnapshot = {
  available: boolean;
  installed: boolean;
};

type PwaInstallRuntime = {
  state: PwaSnapshot;
  prompt?: InstallPromptEvent;
};

declare global {
  interface Window {
    __livioPwaInstall?: PwaInstallRuntime;
  }
}

const serverSnapshot: PwaSnapshot = { available: false, installed: false };

function subscribe(listener: () => void) {
  window.addEventListener('livio-pwa-install-change', listener);
  return () => window.removeEventListener('livio-pwa-install-change', listener);
}

function getSnapshot() {
  return window.__livioPwaInstall?.state ?? serverSnapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

export function usePwaInstall() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function takeInstallPrompt() {
  const runtime = window.__livioPwaInstall;
  const event = runtime?.prompt;
  if (!runtime) return undefined;
  runtime.prompt = undefined;
  runtime.state = { ...runtime.state, available: false };
  window.dispatchEvent(new Event('livio-pwa-install-change'));
  return event;
}

export function markPwaInstalled() {
  const runtime = window.__livioPwaInstall;
  if (!runtime) return;
  runtime.prompt = undefined;
  runtime.state = { available: false, installed: true };
  window.dispatchEvent(new Event('livio-pwa-install-change'));
}
