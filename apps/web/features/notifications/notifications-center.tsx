'use client';

import { useCallback, useEffect, useState } from 'react';
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
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const recentReconciliations = new Map<
  string,
  { completedAt: number; pending?: Promise<boolean> }
>();

function reconcileAlerts(key: string, force: boolean): Promise<boolean> {
  const current = recentReconciliations.get(key);
  if (current?.pending) return current.pending;
  if (!force && current && Date.now() - current.completedAt < RECONCILE_INTERVAL_MS) {
    return Promise.resolve(false);
  }
  const pending = api('/notifications/reconcile', { method: 'POST' }).then(
    () => {
      recentReconciliations.delete(key);
      recentReconciliations.set(key, { completedAt: Date.now() });
      if (recentReconciliations.size > 20) {
        const oldest = recentReconciliations.keys().next().value;
        if (oldest) recentReconciliations.delete(oldest);
      }
      return true;
    },
    (error: unknown) => {
      recentReconciliations.delete(key);
      throw error;
    },
  );
  recentReconciliations.set(key, { completedAt: current?.completedAt ?? 0, pending });
  return pending;
}

export function NotificationsCenter({
  openClient,
  openModule,
  permissions,
  reconcileKey,
}: {
  openClient: (id: string) => void;
  openModule: (module: string) => void;
  permissions: readonly string[];
  reconcileKey: string;
}) {
  const { data, error, reload } = useApiData<NotificationPage>('/notifications');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string>();
  const canUpdate = permissions.includes('notifications:update');
  const canOpenClients = permissions.includes('clients:view');
  const refreshAlerts = useCallback(
    async (force: boolean) => {
      setReconciling(true);
      setReconcileError(undefined);
      try {
        if (await reconcileAlerts(reconcileKey, force)) reload();
      } catch (caught) {
        setReconcileError(
          caught instanceof Error ? caught.message : 'Não foi possível atualizar os alertas.',
        );
      } finally {
        setReconciling(false);
      }
    },
    [reconcileKey, reload],
  );
  useEffect(() => {
    if (!canUpdate) return;
    void refreshAlerts(false);
  }, [canUpdate, refreshAlerts]);
  const read = async (item: Notification) => {
    if (item.status !== 'READ' && canUpdate)
      await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
    reload();
    if (canOpenClients && item.link?.startsWith('client:'))
      openClient(item.link.slice('client:'.length));
    else if (item.link?.startsWith('client:')) openModule('portal');
    if (permissions.includes('tasks:view') && item.link?.startsWith('task:')) openModule('tasks');
  };
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Acompanhamento</p>
          <h1>Notificações</h1>
          <span>
            Parcelas vencidas, próximos vencimentos e lembretes de tarefas em um só lugar.
          </span>
        </div>
        {canUpdate && (
          <button
            className="secondary"
            disabled={reconciling}
            onClick={() => void refreshAlerts(true)}
          >
            {reconciling ? 'Atualizando…' : 'Atualizar alertas'}
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="notice notice-error">
          {error.message}
        </div>
      )}
      {reconcileError && (
        <div role="alert" className="notice notice-error">
          {reconcileError}
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
          <strong>Nenhum alerta pendente</strong>
          <span>As parcelas estão em dia e não há lembretes de tarefas vencidos.</span>
        </div>
      )}
    </section>
  );
}
