'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatMoney } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Page<T> = { items: T[]; total: number };
type Client = { id: string; displayName: string };
type Contract = {
  id: string;
  number: string;
  title: string;
  status: string;
  feeModel: string;
  fixedAmount?: string;
  currency: string;
  startsAt?: string;
  endsAt?: string;
  client?: Client;
};

export function Contracts({ permissions }: { permissions: readonly string[] }) {
  const contracts = useApiData<Page<Contract>>('/finance/contracts?pageSize=100');
  const clients = useApiData<Page<Client>>(
    permissions.includes('clients:view') ? '/clients?pageSize=100' : undefined,
  );
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
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
          fixedAmount: String(form.get('fixedAmount') ?? '').replace(',', '.') || undefined,
          currency: 'BRL',
          serviceCode: form.get('serviceCode') || undefined,
          serviceName: form.get('serviceName') || undefined,
          startsAt: form.get('startsAt') || undefined,
          endsAt: form.get('endsAt') || undefined,
        }),
      });
      setFeedback('Contrato cadastrado.');
      setShowForm(false);
      target.reset();
      contracts.reload();
    } catch (error) {
      setFeedback(
        `Erro: ${error instanceof ApiError ? error.message : 'não foi possível cadastrar'}`,
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
          <span>Cadastre honorários, vigência e serviço contratado por cliente.</span>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setShowForm((value) => !value)}>
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
          <label>
            Número
            <input required name="number" maxLength={80} />
          </label>
          <label>
            Título
            <input required name="title" minLength={2} />
          </label>
          <label>
            Modelo de honorários
            <select required name="feeModel" defaultValue="FIXED">
              <option value="FIXED">Valor fixo</option>
              <option value="HOURLY">Por hora</option>
              <option value="SUCCESS">Êxito</option>
              <option value="MIXED">Misto</option>
            </select>
          </label>
          <label>
            Valor fixo
            <input name="fixedAmount" inputMode="decimal" placeholder="0,00" />
          </label>
          <label>
            Código do serviço
            <input name="serviceCode" maxLength={80} />
          </label>
          <label>
            Serviço
            <input name="serviceName" maxLength={160} />
          </label>
          <label>
            Início
            <input name="startsAt" type="date" />
          </label>
          <label>
            Fim
            <input name="endsAt" type="date" />
          </label>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Cadastrando…' : 'Cadastrar contrato'}
          </button>
        </form>
      )}
      {(contracts.error || clients.error) && (
        <div role="alert" className="notice notice-error">
          {contracts.error?.message ?? clients.error?.message}
          <button onClick={contracts.reload}>Tentar novamente</button>
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
                  <td>{contract.feeModel}</td>
                  <td>{formatMoney(contract.fixedAmount, contract.currency)}</td>
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
    </section>
  );
}
