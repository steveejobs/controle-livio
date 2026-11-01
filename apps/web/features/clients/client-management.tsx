'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';
import { ClientDetail } from './client-detail';
import { IdentificationCapture } from './identification-capture';
import type { IdentificationData } from './identification-reader';
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
  const [scanNotice, setScanNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [clientType, setClientType] = useState<ClientType>('PERSON');
  const [taxId, setTaxId] = useState('');
  const [autoDetectedCompany, setAutoDetectedCompany] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [identityDocument, setIdentityDocument] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [pendingIdentityFile, setPendingIdentityFile] = useState<File>();
  const [clientNotice, setClientNotice] = useState<string>();
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
    setClientNotice(undefined);
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
        initialFeedback={clientNotice}
      />
    );

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSubmitError(undefined);
    const form = new FormData(event.currentTarget);
    const fields = ['nationality', 'civilStatus', 'occupation', 'identityDocument', 'birthDate'];
    const legalIdentity = Object.fromEntries(
      fields
        .map((field) => [field, String(form.get(`legalIdentity.${field}`) || '').trim()])
        .filter(([, value]) => value),
    );
    const representativeName = String(form.get('legalRepresentative.name') || '').trim();
    const representativeTaxId = String(form.get('legalRepresentative.taxId') || '').replace(
      /\D/g,
      '',
    );
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
          customFields: {
            ...(Object.keys(legalIdentity).length ? { legalIdentity } : {}),
            ...(representativeName || representativeTaxId
              ? { legalRepresentative: { name: representativeName, taxId: representativeTaxId } }
              : {}),
          },
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
      let documentNotice: string | undefined;
      if (pendingIdentityFile) {
        try {
          const document = new FormData();
          document.append('file', pendingIdentityFile);
          document.append(
            'title',
            `Documento de identificação · ${String(form.get('displayName'))}`,
          );
          document.append('category', 'IDENTIFICACAO');
          document.append('visibility', 'INTERNAL');
          document.append('clientId', client.id);
          await api('/documents', { method: 'POST', body: document });
        } catch {
          documentNotice =
            'Cliente cadastrado, mas não foi possível salvar a imagem do documento. Abra a ficha e envie o arquivo novamente.';
        }
      }
      setPendingIdentityFile(undefined);
      setShowForm(false);
      reload();
      setGuidedClientId(client.id);
      selectClient(client.id);
      setClientNotice(documentNotice);
    } catch (caught) {
      setSubmitError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar o cliente.',
      );
    } finally {
      setSaving(false);
    }
  };

  const useIdentification = (identified: IdentificationData, file: File) => {
    if (identified.name) setDisplayName(identified.name);
    if (identified.cpf) {
      setClientType('PERSON');
      setAutoDetectedCompany(false);
      setTaxId(formatTaxIdField(identified.cpf, 'PERSON'));
    }
    if (identified.rg) {
      setIdentityDocument([identified.rg, identified.issuingAuthority].filter(Boolean).join(' · '));
    }
    if (identified.birthDate) setBirthDate(identified.birthDate);
    setPendingIdentityFile(file);
    setScanNotice('Confira os dados preenchidos antes de concluir o cadastro.');
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
          <button
            className="primary"
            onClick={() => {
              if (!showForm) {
                setDisplayName('');
                setTaxId('');
                setIdentityDocument('');
                setBirthDate('');
                setPendingIdentityFile(undefined);
                setSubmitError(undefined);
                setScanNotice(undefined);
                setClientNotice(undefined);
                setClientType('PERSON');
              }
              setShowForm((value) => !value);
            }}
          >
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
                    if (nextType === 'COMPANY') {
                      setPendingIdentityFile(undefined);
                      setScanNotice(undefined);
                    }
                  }}
                >
                  <option value="PERSON">Conta individual (pessoa física)</option>
                  <option value="COMPANY">Conta jurídica (empresa)</option>
                </select>
              </label>
              <label>
                {clientType === 'COMPANY' ? 'Nome da empresa' : 'Nome completo'}
                <input
                  name="displayName"
                  required
                  minLength={2}
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
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
              {clientType === 'PERSON' ? (
                <>
                  {permissions.includes('documents:create') && (
                    <IdentificationCapture
                      onImageSelected={setPendingIdentityFile}
                      onUseData={useIdentification}
                    />
                  )}
                  <details className="optional-fields form-wide">
                    <summary>Qualificação para documentos</summary>
                    <p className="section-note">
                      Esses dados completam a procuração e são opcionais no cadastro.
                    </p>
                    <div className="form-grid">
                      <label>
                        Nacionalidade
                        <input name="legalIdentity.nationality" autoComplete="country-name" />
                      </label>
                      <label>
                        Estado civil
                        <input name="legalIdentity.civilStatus" />
                      </label>
                      <label>
                        Profissão
                        <input name="legalIdentity.occupation" />
                      </label>
                      <label>
                        RG e órgão expedidor
                        <input
                          name="legalIdentity.identityDocument"
                          value={identityDocument}
                          onChange={(event) => setIdentityDocument(event.target.value)}
                        />
                      </label>
                      <label>
                        Data de nascimento
                        <input
                          name="legalIdentity.birthDate"
                          type="date"
                          value={birthDate}
                          onChange={(event) => setBirthDate(event.target.value)}
                        />
                      </label>
                    </div>
                  </details>
                  {pendingIdentityFile && (
                    <p className="section-note form-wide" role="status">
                      A imagem será salva na ficha do cliente após concluir o cadastro.
                    </p>
                  )}
                  {scanNotice && (
                    <p className="section-note form-wide" role="status">
                      {scanNotice}
                    </p>
                  )}
                </>
              ) : (
                <details className="optional-fields form-wide">
                  <summary>Representante legal para documentos</summary>
                  <p className="section-note">
                    Informe quem assinará os documentos em nome da empresa.
                  </p>
                  <div className="form-grid">
                    <label>
                      Nome do representante
                      <input name="legalRepresentative.name" autoComplete="name" />
                    </label>
                    <label>
                      CPF do representante
                      <input
                        name="legalRepresentative.taxId"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        maxLength={14}
                        onChange={(event) => {
                          event.currentTarget.value = formatTaxIdField(
                            event.currentTarget.value,
                            'PERSON',
                          );
                        }}
                      />
                    </label>
                  </div>
                </details>
              )}
            </div>
          </fieldset>
          {scanNotice && (
            <p className="section-note form-wide" role="status">
              {scanNotice}
            </p>
          )}
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
