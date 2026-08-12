'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';
import { ClientDetail } from './client-detail';
import type { Client } from './client.types';

type ClientPage = { items: Client[]; total: number };

export function ClientManagement({
  initialClientId,
  onSelectedClientChange,
  permissions = [],
}: {
  initialClientId?: string;
  onSelectedClientChange?: (id?: string) => void;
  permissions?: readonly string[];
}) {
  const [selected, setSelected] = useState(initialClientId);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const { data, error, reload } = useApiData<ClientPage>(
    `/clients?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    300,
  );

  const selectClient = (id?: string) => {
    setSelected(id);
    onSelectedClientChange?.(id);
  };

  const canCreate = permissions.includes('clients:create');
  if (selected)
    return (
      <ClientDetail
        clientId={selected}
        onBack={() => selectClient(undefined)}
        permissions={permissions}
      />
    );

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSubmitError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const client = await api<Client>('/clients', {
        method: 'POST',
        body: JSON.stringify({
          type: form.get('type'),
          displayName: form.get('displayName'),
          legalName: form.get('legalName') || undefined,
          taxId: form.get('taxId') || undefined,
          email: form.get('email') || undefined,
          phone: form.get('phone') || undefined,
          source: form.get('source') || undefined,
        }),
      });
      setShowForm(false);
      reload();
      selectClient(client.id);
    } catch (caught) {
      setSubmitError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar o cliente.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Relacionamento</p>
          <h1>Clientes</h1>
          <span>Cadastro, pesquisa e controle completo do histórico de cada cliente.</span>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Fechar cadastro' : 'Novo cliente'}
          </button>
        )}
      </header>
      {showForm && canCreate && (
        <form className="surface form-grid" data-reveal onSubmit={create}>
          <label>
            Tipo
            <select name="type" defaultValue="PERSON">
              <option value="PERSON">Pessoa física</option>
              <option value="COMPANY">Pessoa jurídica</option>
            </select>
          </label>
          <label>
            Nome
            <input name="displayName" required minLength={2} />
          </label>
          <label>
            Razão social
            <input name="legalName" />
          </label>
          <label>
            CPF/CNPJ
            <input name="taxId" inputMode="numeric" />
          </label>
          <label>
            E-mail
            <input name="email" type="email" />
          </label>
          <label>
            Telefone
            <input name="phone" />
          </label>
          <label>
            Origem
            <input name="source" />
          </label>
          {submitError && (
            <div className="notice notice-error form-wide" role="alert">
              {submitError}
            </div>
          )}
          <button className="primary form-wide" disabled={saving}>
            {saving ? 'Cadastrando…' : 'Cadastrar e abrir cliente'}
          </button>
        </form>
      )}
      <input
        className="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Pesquisar nome, CPF/CNPJ, telefone ou e-mail"
        aria-label="Pesquisar clientes"
      />
      {error && (
        <div role="alert" className="notice notice-error">
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
      ) : data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Contato</th>
                <th>Atualização</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.displayName}</strong>
                    <small>{client.type === 'COMPANY' ? 'Pessoa jurídica' : 'Pessoa física'}</small>
                  </td>
                  <td>{client.taxIdNormalized || '—'}</td>
                  <td>{client.email || client.phone || '—'}</td>
                  <td>{formatDate(client.updatedAt)}</td>
                  <td>
                    <button className="table-action" onClick={() => selectClient(client.id)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum cliente cadastrado</strong>
          <span>Use “Novo cliente” para iniciar.</span>
        </div>
      )}
    </section>
  );
}
