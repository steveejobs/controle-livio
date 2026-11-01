'use client';

import { useState } from 'react';
import { ApiError, downloadApiFile } from '../../lib/api';
import { formatMoney } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type ReportResult = { basis: string; rows: Array<Record<string, unknown>> };
const rangedReports = new Set([
  'receivables-due',
  'received',
  'accrual',
  'cash-flow',
  'cash-flow-by-client',
]);
const initialFrom = `${new Date().getFullYear()}-01-01`;
const initialTo = `${new Date().getFullYear() + 1}-01-01`;

function cell(value: unknown, key: string, currency?: string) {
  if (
    typeof value === 'string' &&
    /(amount|balance|expenses|receivables|net_cash|projected_net)/.test(key)
  )
    return formatMoney(value, currency ?? 'BRL');
  if (value === null || value === undefined) return '—';
  return String(value);
}

export function ReportsCenter({
  permissions,
  isAdministrator,
}: {
  permissions: readonly string[];
  isAdministrator: boolean;
}) {
  const [report, setReport] = useState('receivables-due');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groupBy, setGroupBy] = useState('month');
  const [exportError, setExportError] = useState<string>();
  const query = rangedReports.has(report) ? `?from=${from}&to=${to}&groupBy=${groupBy}` : '';
  const { data, error, reload } = useApiData<ReportResult>(`/reports/${report}${query}`);
  const headers = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  const exportCsv = async () => {
    setExportError(undefined);
    try {
      await downloadApiFile(`/reports/${report}/export.csv${query}`, `livio-${report}.csv`);
    } catch (caught) {
      setExportError(caught instanceof ApiError ? caught.message : 'Não foi possível exportar.');
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Análise financeira</p>
          <h1>Relatórios</h1>
          <span>
            Consulte contas a receber e resultados por período, com exportação CSV autenticada.
          </span>
        </div>
        {isAdministrator && permissions.includes('reports:export') && (
          <button className="secondary" onClick={() => void exportCsv()}>
            Exportar CSV
          </button>
        )}
      </header>
      <div className="surface report-filters" data-reveal>
        <label>
          Relatório
          <select value={report} onChange={(event) => setReport(event.target.value)}>
            <option value="receivables-due">Contas a receber por mês</option>
            <option value="received">Recebimentos</option>
            <option value="accrual">Competência</option>
            <option value="overdue">Títulos vencidos</option>
            <option value="aging">Faixas de atraso</option>
            <option value="cash-forecast">Previsão de caixa</option>
            <option value="cash-flow">Fluxo de caixa real e projetado</option>
            <option value="cash-flow-by-client">Caixa por cliente e processo</option>
            <option value="partial-payments">Pagamentos parciais</option>
            <option value="active-contracts">Contratos ativos</option>
            <option value="revenue-by-lawyer">Receita por advogado</option>
            <option value="revenue-by-service">Receita por serviço</option>
            <option value="delinquent-clients">Clientes inadimplentes</option>
            <option value="reconciliation">Conciliação</option>
          </select>
        </label>
        {rangedReports.has(report) && (
          <>
            <label>
              Data inicial
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <label>
              Agrupar por
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                <option value="day">Dia</option>
                <option value="week">Semana</option>
                <option value="month">Mês</option>
              </select>
            </label>
          </>
        )}
      </div>
      {(error || exportError) && (
        <div role="alert" className="notice notice-error">
          {exportError || error?.message}
          <button onClick={reload}>Tentar novamente</button>
        </div>
      )}
      {!data && !error ? (
        <div className="loading" aria-label="Carregando relatório">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="surface table-wrap" data-reveal>
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header.replaceAll('_', ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, index) => (
                <tr key={index}>
                  {headers.map((header) => (
                    <td key={header}>
                      {cell(
                        row[header],
                        header,
                        typeof row.currency === 'string' ? row.currency : undefined,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.rows.length && (
            <div className="empty">
              <strong>Sem dados no período</strong>
              <span>Altere os filtros ou cadastre recebíveis.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
