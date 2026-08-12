'use client';

import { decimalToCents, formatMoney } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Summary = {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
  monthlyReceivables: Array<{
    month: string;
    dueAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
    installments: number;
  }>;
};

export function OperationalDashboard({
  navigate,
  permissions,
}: {
  navigate: (module: string) => void;
  permissions: readonly string[];
}) {
  const { data, error, reload } = useApiData<Summary>('/dashboard/summary');
  const maximum =
    data?.monthlyReceivables.reduce((value, item) => {
      const current = decimalToCents(item.dueAmount);
      return current > value ? current : value;
    }, 0n) || 1n;
  const barHeight = (value: string, minimum: number) => {
    const cents = decimalToCents(value);
    const percentage = Number((cents * 100n) / maximum);
    return `${Math.max(cents > 0n ? minimum : 0, percentage)}%`;
  };
  const monthLabel = (value: string) =>
    new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
      new Date(`${value}T12:00:00Z`),
    );
  const allowedTargets = new Set([
    ...(permissions.includes('clients:view') ? ['clients'] : []),
    ...(permissions.includes('matters:view') ? ['matters'] : []),
    ...(permissions.includes('receivables:view') ? ['finance'] : []),
    ...(permissions.includes('tasks:view') ? ['tasks'] : []),
  ]);
  const cards = data
    ? ([
        ['Clientes ativos', data.activeClients, 'clients'],
        ['Processos ativos', data.activeMatters, 'matters'],
        ['Títulos vencidos', data.overdueReceivables, 'finance'],
        ['Tarefas abertas', data.openTasks, 'tasks'],
      ] as const)
    : [];
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Controle Financeiro Lívio</p>
          <h1>Visão geral</h1>
          <span>Indicadores operacionais e contas a receber dos próximos seis meses.</span>
        </div>
        {permissions.includes('notifications:view') && (
          <button className="secondary" onClick={() => navigate('notifications')}>
            Ver notificações
          </button>
        )}
      </header>
      {error && (
        <div className="notice notice-error" role="alert">
          {error.message}
          <button onClick={reload}>Tentar novamente</button>
        </div>
      )}
      {!data && !error ? (
        <div className="loading" aria-label="Carregando">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <>
          <div className="metric-grid">
            {cards.map(([label, value, target], index) => (
              <button
                data-reveal
                data-reveal-order={String(index + 1)}
                className="metric"
                key={label}
                onClick={() => navigate(target)}
                disabled={!allowedTargets.has(target)}
              >
                <span>{label}</span>
                <strong>{value}</strong>
                <small>Ver registros</small>
              </button>
            ))}
          </div>
          <section className="surface monthly-report" data-reveal>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Fluxo futuro</p>
                <h2>Contas a receber mensais</h2>
              </div>
              {permissions.includes('reports:view') && (
                <button className="table-action" onClick={() => navigate('reports')}>
                  Abrir relatório
                </button>
              )}
            </div>
            <div className="monthly-chart" aria-label="Contas a receber por mês">
              {data?.monthlyReceivables.map((item) => (
                <article key={item.month}>
                  <div className="bar-track" aria-hidden="true">
                    <i
                      className="bar-due"
                      style={{
                        height: barHeight(item.dueAmount, 4),
                      }}
                    />
                    <i
                      className="bar-received"
                      style={{
                        height: barHeight(item.receivedAmount, 0),
                      }}
                    />
                  </div>
                  <strong>{monthLabel(item.month)}</strong>
                  <span>{formatMoney(item.outstandingAmount)} em aberto</span>
                  <small>{item.installments} parcela(s)</small>
                </article>
              ))}
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-due" /> Previsto
              </span>
              <span>
                <i className="legend-received" /> Recebido
              </span>
            </div>
            <div className="table-wrap embedded-table">
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>Previsto</th>
                    <th>Recebido</th>
                    <th>Em aberto</th>
                    <th>Parcelas</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.monthlyReceivables.map((item) => (
                    <tr key={`row-${item.month}`}>
                      <td>{monthLabel(item.month)}</td>
                      <td>{formatMoney(item.dueAmount)}</td>
                      <td>{formatMoney(item.receivedAmount)}</td>
                      <td>{formatMoney(item.outstandingAmount)}</td>
                      <td>{item.installments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
