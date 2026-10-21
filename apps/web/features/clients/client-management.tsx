'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';
import { ClientDetail } from './client-detail';
import type { Client } from './client.types';
import { formatTaxIdField, type ClientType } from './tax-id-format';

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
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [guidedClientId, setGuidedClientId] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [clientType, setClientType] = useState<ClientType>('PERSON');
  const [taxId, setTaxId] = useState('');
  const [autoDetectedCompany, setAutoDetectedCompany] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const clients = usePaginatedData<Client>(
    `/clients${query ? `?search=${encodeURIComponent(query)}` : ''}`,
  );
  const { data, error, reload } = clients;

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
        startGuidedOnboarding={selected === guidedClientId}
        onGuidedOnboardingComplete={() => setGuidedClientId(undefined)}
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
          address: [
            'street',
            'number',
            'complement',
            'district',
            'city',
            'state',
            'postalCode',
          ].some((field) => String(form.get(`address.${field}`) || '').trim())
            ? {
                street: String(form.get('address.street') || '').trim() || undefined,
                number: String(form.get('address.number') || '').trim() || undefined,
                complement: String(form.get('address.complement') || '').trim() || undefined,
                district: String(form.get('address.district') || '').trim() || undefined,
                city: String(form.get('address.city') || '').trim() || undefined,
                state: String(form.get('address.state') || '').trim() || undefined,
                postalCode: String(form.get('address.postalCode') || '').trim() || undefined,
              }
            : undefined,
        }),
      });
      setShowForm(false);
      reload();
      setGuidedClientId(client.id);
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
          <fieldset className="form-wide onboarding-section">
            <legend>Identificação</legend>
            <div className="form-grid">
              <label>
                Tipo de conta
                <select
                  name="type"
                  value={clientType}
                  onChange={(event) => {
                    const nextType = event.target.value as ClientType;
                    setClientType(nextType);
                    setAutoDetectedCompany(false);
                    setTaxId((value) => formatTaxIdField(value, nextType));
                  }}
                >
                  <option value="PERSON">Conta individual (pessoa física)</option>
                  <option value="COMPANY">Conta jurídica (empresa)</option>
                </select>
              </label>
              <label>
                {clientType === 'COMPANY' ? 'Nome da empresa' : 'Nome completo'}
                <input name="displayName" required minLength={2} autoComplete="name" />
              </label>
              {clientType === 'COMPANY' && (
                <label>
                  Razão social
                  <input name="legalName" required minLength={2} autoComplete="organization" />
                </label>
              )}
              <label>
                {clientType === 'COMPANY' ? 'CNPJ' : 'CPF'}
                <input
                  name="taxId"
                  inputMode="numeric"
                  autoComplete="off"
                  value={taxId}
                  maxLength={18}
                  placeholder={clientType === 'COMPANY' ? '00.000.000/0000-00' : '000.000.000-00'}
                  aria-describedby="tax-id-help"
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 14);
                    let nextType = clientType;
                    if (digits.length > 11) {
                      nextType = 'COMPANY';
                      setAutoDetectedCompany(true);
                    } else if (autoDetectedCompany) {
                      nextType = 'PERSON';
                      setAutoDetectedCompany(false);
                    }
                    setClientType(nextType);
                    setTaxId(formatTaxIdField(digits, nextType));
                  }}
                />
              </label>
              <p id="tax-id-help" className="section-note form-wide">
                Os separadores são inseridos automaticamente. Ao informar mais de 11 dígitos, o
                cadastro muda para pessoa jurídica.
              </p>
            </div>
          </fieldset>
          <fieldset className="form-wide onboarding-section">
            <legend>Contato</legend>
            <div className="form-grid">
              <label>
                E-mail
                <input name="email" type="email" autoComplete="email" />
              </label>
              <label>
                Telefone
                <input name="phone" autoComplete="tel" />
              </label>
              <label>
                Origem do cliente (opcional)
                <input name="source" />
              </label>
            </div>
          </fieldset>
          <fieldset className="form-wide optional-address">
            <legend>
              Endereço <span>(opcional)</span>
            </legend>
            <p className="section-note">
              Você pode informar o endereço agora ou completar o cadastro depois.
            </p>
            <div className="form-grid">
              <label>
                Logradouro
                <input name="address.street" autoComplete="street-address" />
              </label>
              <label>
                Número
                <input name="address.number" />
              </label>
              <label>
                Complemento
                <input name="address.complement" />
              </label>
              <label>
                Bairro
                <input name="address.district" />
              </label>
              <label>
                Cidade
                <input name="address.city" autoComplete="address-level2" />
              </label>
              <label>
                Estado (UF)
                <input name="address.state" maxLength={2} autoComplete="address-level1" />
              </label>
              <label>
                CEP
                <input name="address.postalCode" autoComplete="postal-code" inputMode="numeric" />
              </label>
            </div>
          </fieldset>
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
      {error && !data && (
        <div role="alert" className="notice notice-error">
          {error.message}
          <button onClick={clients.retry}>Tentar novamente</button>
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
                  <td>
                    {client.taxIdNormalized
                      ? formatTaxIdField(client.taxIdNormalized, client.type)
                      : '—'}
                  </td>
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
      ) : !error ? (
        <div className="empty">
          <strong>Nenhum cliente cadastrado</strong>
          <span>Use “Novo cliente” para iniciar.</span>
        </div>
      ) : null}
      {data && (
        <LoadMore
          shown={data.items.length}
          total={data.total}
          loading={clients.loading}
          error={error}
          onLoad={clients.loadMore}
          onRetry={clients.retry}
        />
      )}
    </section>
  );
}
