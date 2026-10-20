'use client';

import { useState, type CSSProperties } from 'react';
import { centsToDecimal, decimalToCents, formatMoney } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type DashboardPeriod = '3m' | '6m' | '12m' | 'all';

type Summary = {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
  period?: DashboardPeriod;
  bucket?: 'month' | 'year';
  monthlyReceivables: Array<{
    month: string;
    dueAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
    installments: number;
  }>;
};

const workspaceLinks = [
  {
    target: 'clients',
    permission: 'clients:view',
    title: 'Clientes',
    detail: 'Cadastros e contatos',
  },
  {
    target: 'matters',
    permission: 'matters:view',
    title: 'Processos',
    detail: 'Andamento jurídico',
  },
  { target: 'tasks', permission: 'tasks:view', title: 'Tarefas', detail: 'Trabalho em aberto' },
  {
    target: 'finance',
    permission: 'receivables:view',
    title: 'Recebíveis',
    detail: 'Parcelas e pagamentos',
  },
  {
    target: 'reports',
    permission: 'reports:view',
    title: 'Relatórios',
    detail: 'Consultas e exportações',
  },
] as const;

export function OperationalDashboard({
  navigate,
  permissions,
}: {
  navigate: (module: string) => void;
  permissions: readonly string[];
}) {
  const [period, setPeriod] = useState<DashboardPeriod>('6m');
  const { data, error, reload } = useApiData<Summary>(`/dashboard/summary?period=${period}`);
  const periodData =
    data?.period === period || (period === '6m' && !data?.period) ? data : undefined;
  const maximum =
    periodData?.monthlyReceivables.reduce((value, item) => {
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
  const bucketLabel = (value: string) =>
    periodData?.bucket === 'year' ? value.slice(0, 4) : monthLabel(value);
  const periodDescription = {
    '3m': 'nos próximos três meses',
    '6m': 'nos próximos seis meses',
    '12m': 'nos próximos doze meses',
    all: 'no período cadastrado',
  }[period];
  const hasReceivables = periodData?.monthlyReceivables.some((item) => item.installments > 0);
  const totals = periodData?.monthlyReceivables.reduce(
    (result, item) => ({
      due: result.due + decimalToCents(item.dueAmount),
      received: result.received + decimalToCents(item.receivedAmount),
      outstanding: result.outstanding + decimalToCents(item.outstandingAmount),
    }),
    { due: 0n, received: 0n, outstanding: 0n },
  );
  const availableLinks = workspaceLinks.filter((link) => permissions.includes(link.permission));
  const allowedTargets = new Set([
    ...(permissions.includes('clients:view') ? ['clients'] : []),
    ...(permissions.includes('matters:view') ? ['matters'] : []),
    ...(permissions.includes('receivables:view') ? ['finance'] : []),
    ...(permissions.includes('tasks:view') ? ['tasks'] : []),
  ]);
  const cards = data
    ? (
        [
          ['Clientes ativos', data.activeClients, 'clients'],
          ['Processos ativos', data.activeMatters, 'matters'],
          ['Títulos vencidos', data.overdueReceivables, 'finance'],
          ['Tarefas abertas', data.openTasks, 'tasks'],
        ] as const
      ).filter(([, , target]) => allowedTargets.has(target))
    : [];
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Controle Financeiro Lívio</p>
          <h1>Visão geral</h1>
          <span>Indicadores operacionais e consulta de recebíveis por período.</span>
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
      {!data && error ? null : !data ? (
        <div className="loading" aria-label="Carregando">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <>
          <div className="metric-grid dashboard-metrics">
            {cards.map(([label, value, target], index) => (
              <button
                data-reveal
                data-reveal-order={String(index + 1)}
                className="metric"
                key={label}
                onClick={() => navigate(target)}
              >
                <span>{label}</span>
                <strong>{value}</strong>
                <small>Ver registros</small>
              </button>
            ))}
          </div>
          <div className="dashboard-main-grid">
            <section className="surface monthly-report" data-reveal>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {period === 'all' ? 'Histórico e projeções' : 'Fluxo de recebíveis'}
                  </p>
                  <h2>Contas a receber</h2>
                </div>
                <div className="dashboard-report-actions">
                  <label className="dashboard-period-filter">
                    <span>Período</span>
                    <select
                      value={period}
                      onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
                      aria-label="Período das contas a receber"
                    >
                      <option value="3m">Próximos 3 meses</option>
                      <option value="6m">Próximos 6 meses</option>
                      <option value="12m">Próximos 12 meses</option>
                      <option value="all">Todo o período</option>
                    </select>
                  </label>
                  {permissions.includes('reports:view') && (
                    <button className="table-action" onClick={() => navigate('reports')}>
                      Abrir relatório
                    </button>
                  )}
                </div>
              </div>
              {!periodData && !error ? (
                <p className="dashboard-period-loading" role="status">
                  Atualizando contas a receber…
                </p>
              ) : periodData && !hasReceivables ? (
                <div className="dashboard-empty-chart">
                  <div className="dashboard-empty-copy">
                    <strong>Nenhuma parcela {periodDescription}.</strong>
                    <span>
                      Os valores serão exibidos nesta linha do tempo assim que houver parcelas
                      cadastradas.
                    </span>
                    {allowedTargets.has('finance') && (
                      <button
                        className="secondary compact-action"
                        onClick={() => navigate('finance')}
                      >
                        Ir para recebíveis
                      </button>
                    )}
                  </div>
                  <div
                    className="dashboard-empty-timeline"
                    role="region"
                    aria-label="Linha do tempo sem parcelas cadastradas"
                    tabIndex={0}
                  >
                    {periodData.monthlyReceivables.map((item) => (
                      <div key={item.month}>
                        <span className="dashboard-empty-slot" aria-hidden="true" />
                        <small>{bucketLabel(item.month)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : periodData ? (
                <>
                  {totals && (
                    <div className="dashboard-financial-totals" aria-label="Totais do período">
                      <div>
                        <span>Previsto</span>
                        <strong>{formatMoney(centsToDecimal(totals.due))}</strong>
                      </div>
                      <div>
                        <span>Recebido</span>
                        <strong>{formatMoney(centsToDecimal(totals.received))}</strong>
                      </div>
                      <div>
                        <span>Em aberto</span>
                        <strong>{formatMoney(centsToDecimal(totals.outstanding))}</strong>
                      </div>
                    </div>
                  )}
                  <section
                    className="monthly-chart"
                    aria-label={`Contas a receber por ${periodData.bucket === 'year' ? 'ano' : 'mês'}`}
                    style={
                      { '--chart-columns': periodData.monthlyReceivables.length } as CSSProperties
                    }
                  >
                    {periodData.monthlyReceivables.map((item) => (
                      <article key={item.month}>
                        <div className="bar-track" aria-hidden="true">
                          <i
                            className="bar-due"
                            title={`Previsto: ${formatMoney(item.dueAmount)}`}
                            style={{ height: barHeight(item.dueAmount, 4) }}
                          />
                          <i
                            className="bar-received"
                            title={`Recebido: ${formatMoney(item.receivedAmount)}`}
                            style={{ height: barHeight(item.receivedAmount, 0) }}
                          />
                        </div>
                        <strong>{bucketLabel(item.month)}</strong>
                        <span>{formatMoney(item.outstandingAmount)} em aberto</span>
                        <small>{item.installments} parcela(s)</small>
                      </article>
                    ))}
                  </section>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-due" /> Previsto
                    </span>
                    <span>
                      <i className="legend-received" /> Recebido
                    </span>
                  </div>
                  <div
                    className="table-wrap embedded-table"
                    role="region"
                    aria-label={`Tabela de contas a receber por ${periodData.bucket === 'year' ? 'ano' : 'mês'}`}
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{periodData.bucket === 'year' ? 'Ano' : 'Mês'}</th>
                          <th>Previsto</th>
                          <th>Recebido</th>
                          <th>Em aberto</th>
                          <th>Parcelas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodData.monthlyReceivables.map((item) => (
                          <tr key={`row-${item.month}`}>
                            <td>{bucketLabel(item.month)}</td>
                            <td>{formatMoney(item.dueAmount)}</td>
                            <td>{formatMoney(item.receivedAmount)}</td>
                            <td>{formatMoney(item.outstandingAmount)}</td>
                            <td>{item.installments}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
            <aside
              className="surface dashboard-workspace"
              data-reveal
              aria-labelledby="dashboard-workspace-title"
            >
              <p className="eyebrow">Seu espaço de trabalho</p>
              <h2 id="dashboard-workspace-title">Acesso rápido</h2>
              <p className="dashboard-workspace-intro">
                {data && data.activeClients === 0 && data.activeMatters === 0
                  ? 'Organize os primeiros cadastros e acompanhe tudo por aqui.'
                  : 'Acesse as áreas principais da operação em um só lugar.'}
              </p>
              <nav aria-label="Acesso rápido aos módulos" className="dashboard-workspace-links">
                {availableLinks.map((link) => (
                  <button key={link.target} onClick={() => navigate(link.target)}>
                    <span>
                      <strong>{link.title}</strong>
                      <small>{link.detail}</small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </nav>
              {data &&
                ((allowedTargets.has('finance') && data.overdueReceivables > 0) ||
                  (allowedTargets.has('tasks') && data.openTasks > 0)) && (
                  <div className="dashboard-workspace-note">
                    <strong>Para acompanhar</strong>
                    {allowedTargets.has('finance') && data.overdueReceivables > 0 && (
                      <span>{data.overdueReceivables} título(s) vencido(s)</span>
                    )}
                    {allowedTargets.has('tasks') && data.openTasks > 0 && (
                      <span>{data.openTasks} tarefa(s) em aberto</span>
                    )}
                  </div>
                )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
