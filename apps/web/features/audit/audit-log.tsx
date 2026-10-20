'use client';

import { formatDate } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';

type AuditPage = {
  items: Array<{
    id: string;
    action: string;
    resource: string;
    resourceId?: string;
    createdAt: string;
  }>;
  total: number;
};

export function AuditLog() {
  const logs = usePaginatedData<AuditPage['items'][number]>('/audit-logs');
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Logs de auditoria</h1>
          <span>Histórico imutável das operações realizadas no sistema.</span>
        </div>
      </header>
      {logs.error && !logs.data && (
        <div role="alert" className="notice notice-error">
          {logs.error.message}
          <button onClick={logs.retry}>Tentar novamente</button>
        </div>
      )}
      {!logs.data && !logs.error ? (
        <div className="loading" role="status" aria-label="Carregando auditoria">
          <i />
          <i />
          <i />
        </div>
      ) : logs.data?.items.length ? (
        <div
          className="surface table-wrap"
          role="region"
          aria-label="Logs de auditoria"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Ação</th>
                <th>Recurso</th>
                <th>Identificador</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.action}</td>
                  <td>{item.resource}</td>
                  <td>{item.resourceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum evento registrado</strong>
          <span>As próximas operações auditáveis aparecerão aqui.</span>
        </div>
      )}
      {logs.data && (
        <LoadMore
          shown={logs.data.items.length}
          total={logs.data.total}
          loading={logs.loading}
          error={logs.error}
          onLoad={logs.loadMore}
          onRetry={logs.retry}
        />
      )}
    </section>
  );
}
