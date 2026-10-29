'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import {
  feeModelLabel,
  formatSuccessRate,
  normalizeMoneyInput,
  percentageToRate,
} from './contract-values';
import { formatDate, formatMoney } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';
import { ServiceSelection } from './service-selection';
import { ContractHearings, type ContractHearingDraft } from './contract-hearings';

type Client = { id: string; displayName: string };
type Contract = {
  id: string;
  number: string;
  title: string;
  status: string;
  feeModel: string;
  fixedAmount?: string;
  successRate?: string;
  currency: string;
  startsAt?: string;
  endsAt?: string;
  serviceName?: string;
  terms?: { services?: string[] };
  client?: Client;
};

export function Contracts({ permissions }: { permissions: readonly string[] }) {
  const contracts = usePaginatedData<Contract>('/finance/contracts');
  const clients = usePaginatedData<Client>(
    permissions.includes('clients:view') ? '/clients' : undefined,
    100,
  );
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [feeModel, setFeeModel] = useState('FIXED');
  const [contractHearings, setContractHearings] = useState<ContractHearingDraft[]>([]);
  const canCreate = permissions.includes('contracts:create');

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    setBusy(true);
    setFeedback(undefined);
    try {
      await api('/finance/contracts', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.get('clientId'),
          number: form.get('number'),
          title: form.get('title'),
          feeModel: form.get('feeModel'),
          fixedAmount: normalizeMoneyInput(String(form.get('fixedAmount') ?? '')),
          successRate: percentageToRate(String(form.get('successRate') ?? '')),
          currency: 'BRL',
          serviceNames: form
            .getAll('serviceNames')
            .filter((value): value is string => typeof value === 'string'),
          hearings: contractHearings.map((hearing) => {
            const startsAt = new Date(hearing.startsAt);
            return {
              startsAt: startsAt.toISOString(),
              endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
              location: hearing.location.trim() || undefined,
              reminderMinutes: hearing.reminderMinutes,
            };
          }),
          startsAt: form.get('startsAt') || undefined,
          endsAt: form.get('endsAt') || undefined,
        }),
      });
      setFeedback('Contrato cadastrado.');
      setShowForm(false);
      setFeeModel('FIXED');
      setContractHearings([]);
      target.reset();
      contracts.reload();
    } catch (error) {
      setFeedback(
        `Erro: ${
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'não foi possível cadastrar'
        }`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Financeiro</p>
          <h1>Contratos</h1>
          <span>Cadastre os honorários e a vigência de cada contrato.</span>
        </div>
        {canCreate && (
          <button
            className="primary"
            onClick={() => {
              setShowForm((value) => !value);
              setFeeModel('FIXED');
              setContractHearings([]);
            }}
          >
            {showForm ? 'Fechar' : 'Novo contrato'}
          </button>
        )}
      </header>
      {feedback && (
        <div
          role="status"
          className={feedback.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
        >
          {feedback}
        </div>
      )}
      {showForm && canCreate && (
        <form className="surface form-grid" onSubmit={create}>
          <label>
            Cliente
            <select required name="clientId" defaultValue="">
              <option value="" disabled>
                Selecione
              </option>
              {clients.data?.items.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.displayName}
                </option>
              ))}
            </select>
          </label>
          {clients.data && (
            <div className="form-wide">
              <LoadMore
                shown={clients.data.items.length}
                total={clients.data.total}
                loading={clients.loading}
                error={clients.error}
                onLoad={clients.loadMore}
                onRetry={clients.retry}
              />
            </div>
          )}
          <label>
            Número do contrato
            <input required name="number" maxLength={80} />
          </label>
          <label>
            Nome do contrato
            <input required name="title" minLength={2} />
          </label>
          <label>
            Modelo de honorários
            <select
              required
              name="feeModel"
              value={feeModel}
              onChange={(event) => setFeeModel(event.target.value)}
            >
              <option value="FIXED">Valor fixo</option>
              <option value="HOURLY">Por hora</option>
              <option value="SUCCESS">Êxito</option>
              <option value="MIXED">Misto</option>
            </select>
          </label>
          {feeModel !== 'SUCCESS' && (
            <label>
              {feeModel === 'HOURLY' ? 'Valor por hora (R$)' : 'Valor fixo (R$)'}
              <input name="fixedAmount" inputMode="decimal" placeholder="0,00" required />
            </label>
          )}
          {(feeModel === 'SUCCESS' || feeModel === 'MIXED') && (
            <label>
              Percentual de êxito
              <input name="successRate" inputMode="decimal" placeholder="Ex.: 15" required />
            </label>
          )}
          <ServiceSelection disabled={busy} />
          <ContractHearings disabled={busy} onChange={setContractHearings} />
          <label>
            Início da vigência (opcional)
            <input name="startsAt" type="date" />
          </label>
          <label>
            Fim da vigência (opcional)
            <input name="endsAt" type="date" />
          </label>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Cadastrando…' : 'Cadastrar contrato'}
          </button>
        </form>
      )}
      {contracts.error && !contracts.data && (
        <div role="alert" className="notice notice-error">
          {contracts.error.message} <button onClick={contracts.retry}>Tentar novamente</button>
        </div>
      )}
      {showForm && clients.error && !clients.data && (
        <div role="alert" className="notice notice-error">
          {clients.error.message} <button onClick={clients.retry}>Tentar novamente</button>
        </div>
      )}
      {!contracts.data && !contracts.error ? (
        <div className="loading" aria-label="Carregando contratos">
          <i />
          <i />
          <i />
        </div>
      ) : contracts.data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Cliente</th>
                <th>Modelo</th>
                <th>Serviços</th>
                <th>Valor</th>
                <th>Vigência</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.data.items.map((contract) => (
                <tr key={contract.id}>
                  <td>
                    <strong>{contract.number}</strong>
                    <small>{contract.title}</small>
                  </td>
                  <td>{contract.client?.displayName ?? '—'}</td>
                  <td>{feeModelLabel(contract.feeModel)}</td>
                  <td>{contract.terms?.services?.join(', ') ?? contract.serviceName ?? '—'}</td>
                  <td>
                    {contract.feeModel === 'SUCCESS'
                      ? `${formatSuccessRate(contract.successRate)}% do êxito`
                      : formatMoney(contract.fixedAmount, contract.currency)}
                    {contract.feeModel === 'MIXED' && contract.successRate
                      ? ` + ${formatSuccessRate(contract.successRate)}% do êxito`
                      : ''}
                  </td>
                  <td>
                    {formatDate(contract.startsAt)} – {formatDate(contract.endsAt)}
                  </td>
                  <td>
                    <span className="badge">{contract.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum contrato</strong>
          <span>Cadastre o primeiro contrato de honorários.</span>
        </div>
      )}
      {contracts.data && (
        <LoadMore
          shown={contracts.data.items.length}
          total={contracts.data.total}
          loading={contracts.loading}
          error={contracts.error}
          onLoad={contracts.loadMore}
          onRetry={contracts.retry}
        />
      )}
    </section>
  );
}
