'use client';

import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';

type PushConfig = { enabled: boolean; publicKey?: string; subscriptions: string[] };
type PushState = 'loading' | 'off' | 'on' | 'unsupported' | 'blocked';

function applicationServerKey(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isAppleMobile() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

export function PushNotificationSettings() {
  const [state, setState] = useState<PushState>('loading');
  const [config, setConfig] = useState<PushConfig>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }

    let active = true;
    void Promise.all([
      api<PushConfig>('/notifications/push/config'),
      navigator.serviceWorker.register('/sw.js', { scope: '/' }),
    ])
      .then(async ([pushConfig, registration]) => {
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        setConfig(pushConfig);
        setState(
          subscription && pushConfig.subscriptions.includes(subscription.endpoint) ? 'on' : 'off',
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState('off');
        setMessage(
          error instanceof ApiError
            ? error.message
            : 'Não foi possível preparar as notificações neste navegador.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      if (isAppleMobile() && !isStandalone()) {
        setMessage(
          'No iPhone ou iPad, primeiro instale o Lívio pela opção acima e abra pelo ícone da tela inicial.',
        );
        return;
      }
      if (!config?.enabled || !config.publicKey) {
        setMessage('As notificações ainda não foram configuradas no servidor.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        setMessage(
          permission === 'denied'
            ? 'A permissão foi bloqueada. Libere as notificações nas configurações deste site no navegador.'
            : 'Permita as notificações para receber alertas neste dispositivo.',
        );
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.publicKey) as BufferSource,
        }));
      await api('/notifications/push-subscriptions', {
        method: 'POST',
        body: JSON.stringify(subscription.toJSON()),
      });
      setState('on');
      setMessage('Este dispositivo está pronto para receber notificações do Lívio.');
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível ativar as notificações. Confira a permissão do navegador e tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api('/notifications/push-subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('off');
      setMessage('As notificações foram desativadas neste dispositivo.');
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível desativar as notificações neste dispositivo.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface notification-push" aria-labelledby="notification-push-title">
      <div>
        <p className="eyebrow">Neste dispositivo</p>
        <h2 id="notification-push-title">Notificações do Lívio</h2>
        <p>
          Receba avisos do sistema mesmo quando o Lívio estiver fechado. A permissão é independente
          para cada celular ou computador.
        </p>
        {state === 'unsupported' && (
          <p role="status">Este navegador não oferece notificações em segundo plano.</p>
        )}
        {state === 'blocked' && (
          <p role="status">As notificações estão bloqueadas nas configurações do navegador.</p>
        )}
        {state === 'on' && <p role="status">Ativas neste dispositivo.</p>}
        {state === 'loading' && <p role="status">Verificando suporte do navegador…</p>}
        {message && (
          <p className="notification-push__message" role="status">
            {message}
          </p>
        )}
      </div>
      {state === 'off' && config?.enabled && (
        <button className="primary" disabled={busy} onClick={() => void enable()}>
          {busy ? 'Ativando…' : 'Ativar notificações neste dispositivo'}
        </button>
      )}
      {state === 'off' && config && !config.enabled && (
        <p className="notification-push__setup">A configuração do servidor ainda está pendente.</p>
      )}
      {state === 'on' && (
        <button className="secondary" disabled={busy} onClick={() => void disable()}>
          {busy ? 'Desativando…' : 'Desativar neste dispositivo'}
        </button>
      )}
    </section>
  );
}
