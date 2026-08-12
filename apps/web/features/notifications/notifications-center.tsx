'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Notification = {
  id: string;
  title: string;
  body: string;
  status: string;
  link?: string;
  createdAt: string;
  metadata?: { kind?: string };
};
type NotificationPage = { items: Notification[]; unread: number };

export function NotificationsCenter({ openClient }: { openClient: (id: string) => void }) {
  const { data, error, reload } = useApiData<NotificationPage>('/notifications');
  const [reconciling, setReconciling] = useState(false);
  useEffect(() => {
    setReconciling(true);
    api('/notifications/reconcile', { method: 'POST' })
      .then(reload)
      .catch(() => undefined)
      .finally(() => setReconciling(false));
  }, [reload]);
  const read = async (item: Notification) => {
    if (item.status !== 'READ') await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
    reload();
    if (item.link?.startsWith('client:')) openClient(item.link.slice('client:'.length));
  };
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Acompanhamento</p>
          <h1>Notificações</h1>
          <span>
            Parcelas vencidas e próximas do vencimento, atualizadas a partir do financeiro.
          </span>
        </div>
        <button
          className="secondary"
          disabled={reconciling}
          onClick={() => {
            setReconciling(true);
            api('/notifications/reconcile', { method: 'POST' })
              .then(reload)
              .finally(() => setReconciling(false));
          }}
        >
          {reconciling ? 'Atualizando…' : 'Atualizar alertas'}
        </button>
      </header>
      {error && (
        <div role="alert" className="notice notice-error">
          {error.message}
        </div>
      )}
      <div className="notification-summary" data-reveal>
        <strong>{data?.unread ?? 0}</strong>
        <span>alertas não lidos</span>
      </div>
      <div className="notification-list">
        {data?.items.map((item, index) => (
          <button
            data-reveal
            data-reveal-order={String(Math.min(index + 1, 4))}
            className={
              item.status === 'READ'
                ? 'surface notification-card is-read'
                : 'surface notification-card'
            }
            key={item.id}
            onClick={() => void read(item)}
          >
            <span
              className={item.metadata?.kind === 'OVERDUE' ? 'alert-dot overdue' : 'alert-dot'}
              aria-hidden="true"
            />
            <span>
              <strong>{item.title}</strong>
              <small>{item.body}</small>
              <time>{formatDate(item.createdAt)}</time>
            </span>
          </button>
        ))}
      </div>
      {data && !data.items.length && (
        <div className="empty">
          <strong>Nenhum alerta financeiro</strong>
          <span>As parcelas estão em dia ou ainda não há cobranças cadastradas.</span>
        </div>
      )}
    </section>
  );
}
