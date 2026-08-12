'use client';

import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

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
  const logs = useApiData<AuditPage>('/audit-logs?pageSize=100');
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Logs de auditoria</h1>
          <span>Histórico imutável das operações realizadas no sistema.</span>
        </div>
      </header>
      {logs.error && (
        <div role="alert" className="notice notice-error">
          {logs.error.message}
          <button onClick={logs.reload}>Tentar novamente</button>
        </div>
      )}
      {!logs.data && !logs.error ? (
        <div className="loading" aria-label="Carregando auditoria">
          <i />
          <i />
          <i />
        </div>
      ) : logs.data?.items.length ? (
        <div className="surface table-wrap">
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
    </section>
  );
}
