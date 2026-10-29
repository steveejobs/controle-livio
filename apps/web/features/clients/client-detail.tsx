'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { addMonths, decimalToCents, formatDate, formatMoney, splitAmount } from '../shared/format';
import {
  feeModelLabel,
  formatSuccessRate,
  normalizeMoneyInput,
  percentageToRate,
} from '../finance/contract-values';
import { useApiData } from '../shared/use-api-data';
import { ServiceSelection } from '../finance/service-selection';
import { ContractHearings, type ContractHearingDraft } from '../finance/contract-hearings';
import type { ClientOverview } from './client.types';
import { formatTaxIdField } from './tax-id-format';
import { ClientPhoto } from './client-photo';
import { WhatsAppCollection } from './whatsapp-collection';

const documentTypes = [
  { category: 'CONTRATO_HONORARIOS', label: 'Contrato de honorários' },
  { category: 'PROCURACAO', label: 'Procuração' },
  { category: 'HIPOSSUFICIENCIA', label: 'Declaração de hipossuficiência' },
] as const;
const attachableDocumentTypes = documentTypes.filter(
  (document) => document.category !== 'CONTRATO_HONORARIOS',
);

const onboardingSteps = ['Cadastro', 'Financeiro', 'Honorários', 'Documentos'] as const;

function ClientPanel({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="surface client-panel" data-reveal id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function ClientDetail({
  clientId,
  onBack,
  permissions,
  initialFeedback,
  startGuidedOnboarding = false,
  onGuidedOnboardingComplete,
}: {
  clientId: string;
  onBack: () => void;
  permissions: readonly string[];
  startGuidedOnboarding?: boolean;
  onGuidedOnboardingComplete?: () => void;
  initialFeedback?: string;
}) {
  const { data, error, reload } = useApiData<ClientOverview>(`/clients/${clientId}/overview`);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(
    startGuidedOnboarding ? 2 : null,
  );
  const [guidedCompletedCategories, setGuidedCompletedCategories] = useState<string[]>([]);
  const onboardingHeadingRef = useRef<HTMLHeadingElement>(null);
  const [feedback, setFeedback] = useState<string | undefined>(initialFeedback);
  const [saving, setSaving] = useState(false);
  const [showReceivableForm, setShowReceivableForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [contractFeeModel, setContractFeeModel] = useState('FIXED');
  const [contractHearings, setContractHearings] = useState<ContractHearingDraft[]>([]);
  const [documentCategory, setDocumentCategory] = useState<string>(documentTypes[0].category);
  const [documentTitle, setDocumentTitle] = useState<string>(documentTypes[0].label);
  const [documentContractId, setDocumentContractId] = useState('');
  const [attachedDocumentCategory, setAttachedDocumentCategory] = useState<string>(
    attachableDocumentTypes[0]!.category,
  );
  const [attachedDocumentTitle, setAttachedDocumentTitle] = useState<string>(
    attachableDocumentTypes[0]!.label,
  );
  const canUpdateClient = permissions.includes('clients:update');
  const canAddContact = permissions.includes('clients:create');
  const canUpload = permissions.includes('documents:create');
  const canViewDocuments = permissions.includes('documents:view');
  const canViewContracts = permissions.includes('contracts:view');
  const canCreateContract = permissions.includes('contracts:create');
  const canViewReceivables = permissions.includes('receivables:view');
  const canCreateReceivable = permissions.includes('receivables:create');
  const canViewPayments = permissions.includes('payments:view');
  const canMessage = permissions.includes('messages:create');
  const canNote = permissions.includes('notes:create');
  const guidedOnboarding = onboardingStep !== null;

  useEffect(() => {
    if (onboardingStep === 2 && canCreateReceivable) setShowReceivableForm(true);
    if (onboardingStep === 3 && canCreateContract) setShowContractForm(true);
    if (onboardingStep !== null) onboardingHeadingRef.current?.focus({ preventScroll: true });
  }, [onboardingStep, canCreateReceivable, canCreateContract, data]);

  useEffect(() => {
    if (onboardingStep !== 4 || !data) return;
    if (!documentContractId && data.contracts[0]) setDocumentContractId(data.contracts[0].id);
    const completedCategories = new Set([
      ...data.documents.map((document) => document.category),
      ...guidedCompletedCategories,
    ]);
    const nextDocument = documentTypes.find(
      (document) => !completedCategories.has(document.category),
    );
    if (nextDocument) {
      setDocumentCategory(nextDocument.category);
      setDocumentTitle(nextDocument.label);
    } else {
      setOnboardingStep(5);
    }
  }, [onboardingStep, data, guidedCompletedCategories, documentContractId]);

  const moveToOnboardingStep = (step: number | null) => setOnboardingStep(step);
  const finishGuidedOnboarding = () => {
    setOnboardingStep(null);
    onGuidedOnboardingComplete?.();
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(message);
      reload();
      return true;
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof Error ? caught.message : 'não foi possível concluir a operação.'}`,
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (error)
    return (
      <section>
        <button className="secondary compact-action" onClick={onBack}>
          Voltar
        </button>
        <div role="alert" className="notice notice-error">
          {error.message}
        </div>
      </section>
    );
  if (!data)
    return (
      <div className="loading" aria-label="Carregando cliente">
        <i />
        <i />
        <i />
      </div>
    );

  const customFields = data.client.customFields ?? {};
  const legalIdentity = (customFields.legalIdentity ?? {}) as {
    nationality?: string;
    civilStatus?: string;
    occupation?: string;
    identityDocument?: string;
    birthDate?: string;
  };
  const legalRepresentative = (customFields.legalRepresentative ?? {}) as {
    name?: string;
    taxId?: string;
  };

  const edit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        api(`/clients/${clientId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: String(form.get('displayName')),
            legalName: String(form.get('legalName') || '') || undefined,
            email: String(form.get('email') || '') || undefined,
            phone: String(form.get('phone') || '') || undefined,
            source: String(form.get('source') || '') || undefined,
            address: {
              ...data.client.address,
              street: String(form.get('address.street') || '').trim() || undefined,
              number: String(form.get('address.number') || '').trim() || undefined,
              complement: String(form.get('address.complement') || '').trim() || undefined,
              district: String(form.get('address.district') || '').trim() || undefined,
              city: String(form.get('address.city') || '').trim() || undefined,
              state: String(form.get('address.state') || '').trim() || undefined,
              postalCode: String(form.get('address.postalCode') || '').trim() || undefined,
            },
            customFields: {
              ...customFields,
              ...(data.client.type === 'PERSON'
                ? {
                    legalIdentity: {
                      nationality: String(form.get('legalIdentity.nationality') || '').trim(),
                      civilStatus: String(form.get('legalIdentity.civilStatus') || '').trim(),
                      occupation: String(form.get('legalIdentity.occupation') || '').trim(),
                      identityDocument: String(
                        form.get('legalIdentity.identityDocument') || '',
                      ).trim(),
                      birthDate: String(form.get('legalIdentity.birthDate') || '').trim(),
                    },
                  }
                : {
                    legalRepresentative: {
                      name: String(form.get('legalRepresentative.name') || '').trim(),
                      taxId: String(form.get('legalRepresentative.taxId') || '').replace(/\D/g, ''),
                    },
                  }),
            },
          }),
        }),
      'Cadastro atualizado.',
    ).then((succeeded) => {
      if (succeeded && onboardingStep === 1) moveToOnboardingStep(2);
    });
  };

  const addContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void run(
      () =>
        api(`/clients/${clientId}/contacts`, {
          method: 'POST',
          body: JSON.stringify({
            name: String(form.get('name')),
            role: String(form.get('role') || '') || undefined,
            email: String(form.get('email') || '') || undefined,
            phone: String(form.get('phone') || '') || undefined,
            isPrimary: form.get('isPrimary') === 'on',
          }),
        }),
      'Contato adicionado.',
    ).then((succeeded) => {
      if (succeeded) target.reset();
    });
  };

  const createContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const feeModel = String(form.get('feeModel'));
    void run(
      () =>
        api('/finance/contracts', {
          method: 'POST',
          body: JSON.stringify({
            clientId,
            number: String(form.get('number') || '').trim(),
            title: String(form.get('title') || '').trim(),
            feeModel,
            receivableId: String(form.get('receivableId') || '') || undefined,
            fixedAmount: normalizeMoneyInput(String(form.get('fixedAmount') || '')),
            successRate:
              feeModel === 'SUCCESS' || feeModel === 'MIXED'
                ? percentageToRate(String(form.get('successRate') || ''))
                : undefined,
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
        }),
      'Contrato de honorários cadastrado.',
    ).then((succeeded) => {
      if (succeeded) {
        target.reset();
        setContractFeeModel('FIXED');
        setContractHearings([]);
        setShowContractForm(false);
        if (onboardingStep === 3) moveToOnboardingStep(4);
      }
    });
  };

  const createReceivable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const originalAmount = normalizeMoneyInput(String(form.get('total') || ''));
      if (!originalAmount || decimalToCents(originalAmount) <= 0n) {
        throw new Error('Informe um valor maior que zero.');
      }
      const issueDate = String(form.get('issueDate') || '');
      const firstDueDate = String(form.get('firstDueDate') || '');
      const installmentCount = Number(form.get('installmentCount'));
      const installments = splitAmount(originalAmount, '', installmentCount).map(
        (amount, index) => ({
          sequence: index + 1,
          amount,
          dueDate: addMonths(firstDueDate, index),
        }),
      );
      const contractId = String(form.get('contractId') || '');
      void run(
        () =>
          api('/finance/receivables', {
            method: 'POST',
            body: JSON.stringify({
              clientId,
              reference: String(form.get('reference') || '').trim(),
              description: String(form.get('description') || '').trim(),
              originalAmount,
              currency: 'BRL',
              issueDate,
              installments,
              ...(contractId ? { contractId } : {}),
            }),
          }),
        'Cobrança e parcelas cadastradas.',
      ).then((succeeded) => {
        if (succeeded) {
          target.reset();
          setShowReceivableForm(false);
          if (onboardingStep === 2) moveToOnboardingStep(3);
        }
      });
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof Error ? caught.message : 'informe valores e vencimento válidos.'}`,
      );
    }
  };

  const addText = (event: FormEvent<HTMLFormElement>, kind: 'message' | 'note') => {
    event.preventDefault();
    const target = event.currentTarget;
    const body = String(new FormData(target).get('body'));
    const path = kind === 'message' ? '/client-messages' : '/internal-notes';
    void run(
      () => api(path, { method: 'POST', body: JSON.stringify({ clientId, body }) }),
      kind === 'message' ? 'Observação publicada para o cliente.' : 'Nota interna salva.',
    ).then((succeeded) => {
      if (succeeded) target.reset();
    });
  };

  const uploadClientDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const source = new FormData(target);
    const file = source.get('file');
    if (!(file instanceof File) || !file.size) return;
    const payload = new FormData();
    payload.set('file', file);
    payload.set('title', String(source.get('title')));
    const category = String(source.get('category'));
    payload.set('category', category);
    payload.set('visibility', 'INTERNAL');
    payload.set('clientId', clientId);
    const contractId = String(source.get('contractId') || '');
    if (category === 'CONTRATO_HONORARIOS' && contractId) payload.set('contractId', contractId);
    void run(
      () => api('/documents', { method: 'POST', body: payload }),
      'Documento anexado com acesso interno.',
    ).then((succeeded) => {
      if (succeeded) {
        target.reset();
        if (onboardingStep === 4) {
          setGuidedCompletedCategories((current) => [...new Set([...current, category])]);
        } else {
          setAttachedDocumentCategory(attachableDocumentTypes[0]!.category);
          setAttachedDocumentTitle(attachableDocumentTypes[0]!.label);
        }
      }
    });
  };

  const uploadExistingContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const source = new FormData(target);
    const file = source.get('file');
    if (!(file instanceof File) || !file.size) return;
    const contractId = String(source.get('contractId') || '');
    const contract = data.contracts.find((item) => item.id === contractId);
    const contractLabel = contract
      ? `${contract.number} · ${contract.title}`
      : data.client.displayName;
    const title = `Contrato assinado · ${contractLabel} · ${file.name}`.slice(0, 240);
    const payload = new FormData();
    payload.set('file', file);
    payload.set('title', title);
    payload.set('category', 'CONTRATO_HONORARIOS');
    payload.set('visibility', 'INTERNAL');
    payload.set('clientId', clientId);
    if (contract) payload.set('contractId', contract.id);
    void run(
      () => api('/documents', { method: 'POST', body: payload }),
      'Contrato digitalizado salvo com acesso interno.',
    ).then((succeeded) => {
      if (succeeded) {
        const fileInput = target.elements.namedItem('file');
        if (fileInput instanceof HTMLInputElement) fileInput.value = '';
        if (onboardingStep === 4) {
          setGuidedCompletedCategories((current) => [
            ...new Set([...current, 'CONTRATO_HONORARIOS']),
          ]);
        }
      }
    });
  };

  const generateClientDocument = () => {
    if (documentCategory === 'CONTRATO_HONORARIOS' && !documentContractId) {
      setFeedback('Cadastre um contrato de honorários antes de gerar este documento.');
      return;
    }
    void run(
      () =>
        api('/documents/generate', {
          method: 'POST',
          body: JSON.stringify({
            clientId,
            category: documentCategory,
            ...(documentCategory === 'CONTRATO_HONORARIOS'
              ? { contractId: documentContractId }
              : {}),
          }),
        }),
      `${documentTitle} gerado e salvo no histórico do cliente.`,
    ).then((succeeded) => {
      if (succeeded && onboardingStep === 4) {
        setGuidedCompletedCategories((current) => [...new Set([...current, documentCategory])]);
      }
    });
  };

  const openDocument = async (id: string) => {
    try {
      const result = await api<{ url: string }>(`/documents/${id}/download-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setFeedback(
        caught instanceof ApiError ? caught.message : 'Não foi possível abrir o arquivo.',
      );
    }
  };

  return (
    <section className="client-workspace">
      <header className="page-title client-heading">
        <ClientPhoto
          clientId={clientId}
          name={data.client.displayName}
          hasPhoto={Boolean(data.client.photoStorageKey)}
          canEdit={canUpdateClient}
        />
        <div>
          <p>Cliente</p>
          <h1>{data.client.displayName}</h1>
          <span>
            {data.client.type === 'COMPANY' ? 'Pessoa jurídica' : 'Pessoa física'}
            {data.client.taxIdNormalized
              ? ` · ${formatTaxIdField(data.client.taxIdNormalized, data.client.type)}`
              : ''}
            {' · '}Dados, financeiro e documentos do cliente em um só lugar.
          </span>
        </div>
        <button className="secondary compact-action" onClick={onBack}>
          Voltar à lista
        </button>
      </header>
      {feedback && (
        <div
          role="status"
          className={feedback.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
        >
          {feedback}
        </div>
      )}

      {guidedOnboarding && (
        <section
          className="client-onboarding"
          id="client-onboarding"
          aria-label="Fluxo de cadastro"
        >
          <ol className="client-onboarding-progress">
            {onboardingSteps.map((label, index) => {
              const step = index + 1;
              const complete = onboardingStep === 5 || onboardingStep! > step;
              const active = onboardingStep === step;
              return (
                <li
                  className={complete ? 'is-complete' : active ? 'is-current' : ''}
                  aria-current={active ? 'step' : undefined}
                  key={label}
                >
                  <span>{complete ? '✓' : step}</span>
                  <b>{label}</b>
                </li>
              );
            })}
          </ol>
          <div aria-live="polite">
            <h2 ref={onboardingHeadingRef} tabIndex={-1}>
              {onboardingStep === 5
                ? 'Fluxo inicial concluído'
                : `Etapa ${onboardingStep}: ${onboardingSteps[onboardingStep! - 1]}`}
            </h2>
            <p>
              {onboardingStep === 5
                ? 'Cadastro, financeiro, honorários e documentos foram organizados. Você pode abrir a ficha completa para continuar o atendimento.'
                : 'Preencha esta etapa e o fluxo seguirá automaticamente para a próxima.'}
            </p>
          </div>
          {onboardingStep === 5 && (
            <button className="primary" type="button" onClick={finishGuidedOnboarding}>
              Abrir ficha completa
            </button>
          )}
        </section>
      )}

      {!guidedOnboarding && (
        <nav className="client-flow-nav" aria-label="Etapas do cadastro do cliente">
          <a href="#dados-cliente">
            <b>1</b> Cadastro
          </a>
          <a href="#financeiro-cliente">
            <b>2</b> Financeiro
          </a>
          <a href="#honorarios-cliente">
            <b>3</b> Honorários
          </a>
          <a href="#documentos-cliente">
            <b>4</b> Documentos
          </a>
        </nav>
      )}

      {(!guidedOnboarding || onboardingStep === 1) && (
        <div className="client-grid">
          <ClientPanel id="dados-cliente" title="Dados do cliente">
            <form className="stack-form" onSubmit={edit}>
              <label>
                {data.client.type === 'COMPANY' ? 'Nome da empresa' : 'Nome completo'}
                <input
                  name="displayName"
                  required
                  disabled={!canUpdateClient}
                  defaultValue={data.client.displayName}
                />
              </label>
              {data.client.type === 'COMPANY' && (
                <label>
                  Razão social
                  <input
                    name="legalName"
                    disabled={!canUpdateClient}
                    defaultValue={data.client.legalName}
                  />
                </label>
              )}
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  disabled={!canUpdateClient}
                  defaultValue={data.client.email}
                />
              </label>
              <label>
                Telefone
                <input name="phone" disabled={!canUpdateClient} defaultValue={data.client.phone} />
              </label>
              <label>
                Origem do cliente (opcional)
                <input
                  name="source"
                  disabled={!canUpdateClient}
                  defaultValue={data.client.source}
                />
              </label>
              {data.client.type === 'PERSON' ? (
                <details className="optional-fields">
                  <summary>Qualificação para documentos</summary>
                  <p className="section-note">
                    Atualizar estes dados altera as próximas versões geradas.
                  </p>
                  <div className="stack-form">
                    <label>
                      Nacionalidade
                      <input
                        name="legalIdentity.nationality"
                        disabled={!canUpdateClient}
                        defaultValue={legalIdentity.nationality}
                      />
                    </label>
                    <label>
                      Estado civil
                      <input
                        name="legalIdentity.civilStatus"
                        disabled={!canUpdateClient}
                        defaultValue={legalIdentity.civilStatus}
                      />
                    </label>
                    <label>
                      Profissão
                      <input
                        name="legalIdentity.occupation"
                        disabled={!canUpdateClient}
                        defaultValue={legalIdentity.occupation}
                      />
                    </label>
                    <label>
                      RG e órgão expedidor
                      <input
                        name="legalIdentity.identityDocument"
                        disabled={!canUpdateClient}
                        defaultValue={legalIdentity.identityDocument}
                      />
                    </label>
                    <label>
                      Data de nascimento
                      <input
                        name="legalIdentity.birthDate"
                        type="date"
                        disabled={!canUpdateClient}
                        defaultValue={legalIdentity.birthDate}
                      />
                    </label>
                  </div>
                </details>
              ) : (
                <details className="optional-fields">
                  <summary>Representante legal para documentos</summary>
                  <p className="section-note">
                    As próximas versões usarão o nome e o CPF informados aqui.
                  </p>
                  <div className="stack-form">
                    <label>
                      Nome do representante
                      <input
                        name="legalRepresentative.name"
                        disabled={!canUpdateClient}
                        defaultValue={legalRepresentative.name}
                      />
                    </label>
                    <label>
                      CPF do representante
                      <input
                        name="legalRepresentative.taxId"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        maxLength={14}
                        disabled={!canUpdateClient}
                        defaultValue={formatTaxIdField(legalRepresentative.taxId ?? '', 'PERSON')}
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
              <fieldset className="optional-address">
                <legend>
                  Endereço <span>(opcional)</span>
                </legend>
                <div className="stack-form">
                  <label>
                    Logradouro
                    <input
                      name="address.street"
                      autoComplete="street-address"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.street}
                    />
                  </label>
                  <label>
                    Número
                    <input
                      name="address.number"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.number}
                    />
                  </label>
                  <label>
                    Complemento
                    <input
                      name="address.complement"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.complement}
                    />
                  </label>
                  <label>
                    Bairro
                    <input
                      name="address.district"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.district}
                    />
                  </label>
                  <label>
                    Cidade
                    <input
                      name="address.city"
                      autoComplete="address-level2"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.city}
                    />
                  </label>
                  <label>
                    Estado (UF)
                    <input
                      name="address.state"
                      maxLength={2}
                      autoComplete="address-level1"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.state}
                    />
                  </label>
                  <label>
                    CEP
                    <input
                      name="address.postalCode"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      disabled={!canUpdateClient}
                      defaultValue={data.client.address?.postalCode}
                    />
                  </label>
                </div>
              </fieldset>
              {canUpdateClient && (
                <button className="primary" disabled={saving}>
                  Salvar alterações
                </button>
              )}
            </form>
          </ClientPanel>

          <ClientPanel title="Contatos">
            <div className="record-list">
              {data.contacts.length ? (
                data.contacts.map((item) => (
                  <article key={item.id}>
                    <strong>
                      {item.name}
                      {item.isPrimary ? ' · principal' : ''}
                    </strong>
                    <span>
                      {item.role || 'Contato'} · {item.email || item.phone || 'Sem canal informado'}
                    </span>
                  </article>
                ))
              ) : (
                <p className="section-note">Nenhuma outra pessoa vinculada a este cliente.</p>
              )}
            </div>
            {canAddContact && (
              <details className="optional-fields contact-entry">
                <summary>Adicionar outra pessoa</summary>
                <p className="section-note">
                  O telefone e o e-mail do próprio cliente ficam no cadastro acima. Use este
                  formulário para alguém ligado a ele, como representante, familiar ou responsável
                  financeiro.
                </p>
                <form className="stack-form compact-form" onSubmit={addContact}>
                  <label>
                    Nome da pessoa
                    <input required name="name" autoComplete="name" />
                  </label>
                  <label>
                    Relação ou função
                    <input name="role" placeholder="Ex.: representante legal" />
                  </label>
                  <label>
                    E-mail
                    <input name="email" type="email" autoComplete="email" />
                  </label>
                  <label>
                    Telefone
                    <input name="phone" autoComplete="tel" />
                  </label>
                  <label className="check">
                    <input name="isPrimary" type="checkbox" /> Contato principal
                  </label>
                  <button className="secondary" disabled={saving}>
                    Salvar contato
                  </button>
                </form>
              </details>
            )}
          </ClientPanel>
        </div>
      )}

      {(!guidedOnboarding || onboardingStep === 2) && (
        <ClientPanel id="financeiro-cliente" title="Financeiro do cliente">
          <div className="summary-strip">
            {!canViewReceivables ? (
              <span className="balance-summary">
                <small>Saldo em aberto</small>
                <b>Sem permissão de consulta</b>
              </span>
            ) : data.financial.outstanding.length ? (
              data.financial.outstanding.map((item) => (
                <span className="balance-summary" key={item.currency}>
                  <small>Em aberto</small>
                  <b>{formatMoney(item.amount, item.currency)}</b>
                </span>
              ))
            ) : (
              <span className="balance-summary">
                <small>Em aberto</small>
                <b>R$ 0,00</b>
              </span>
            )}
            <span>
              <b>{canViewReceivables ? data.financial.receivables.length : '—'}</b> recebíveis
            </span>
            <span>
              <b>{canViewPayments ? data.financial.payments.length : '—'}</b> pagamentos
            </span>
            <span>
              <b>{canViewDocuments ? data.documents.length : '—'}</b> documentos
            </span>
          </div>
          {canViewReceivables &&
            (canCreateReceivable || permissions.includes('payments:create')) && (
              <WhatsAppCollection
                client={data.client}
                contacts={data.contacts}
                outstanding={data.financial.outstanding}
              />
            )}
          {canCreateReceivable && (
            <>
              <button
                className="secondary"
                type="button"
                aria-expanded={showReceivableForm}
                onClick={() => setShowReceivableForm((value) => !value)}
              >
                {showReceivableForm ? 'Fechar cobrança' : 'Registrar valor a receber'}
              </button>
              {showReceivableForm && (
                <form
                  className="form-grid compact-form receivable-entry"
                  onSubmit={createReceivable}
                >
                  <label>
                    Referência da cobrança
                    <input name="reference" required maxLength={80} placeholder="HON-2026-001" />
                  </label>
                  <label>
                    O que está sendo cobrado
                    <input
                      name="description"
                      required
                      minLength={2}
                      maxLength={500}
                      defaultValue={`Honorários — ${data.client.displayName}`}
                    />
                  </label>
                  <label>
                    Valor total (R$)
                    <input name="total" required inputMode="decimal" placeholder="1.500,00" />
                  </label>
                  <label>
                    Quantidade de parcelas
                    <input
                      name="installmentCount"
                      required
                      type="number"
                      min={1}
                      max={240}
                      step={1}
                      defaultValue={1}
                    />
                  </label>
                  <label>
                    Data de emissão
                    <input name="issueDate" required type="date" />
                  </label>
                  <label>
                    Vencimento da primeira parcela
                    <input name="firstDueDate" required type="date" />
                  </label>
                  {canViewContracts && data.contracts.length > 0 && (
                    <label>
                      Contrato relacionado
                      <select
                        key={data.contracts.length}
                        name="contractId"
                        defaultValue={data.contracts.length === 1 ? data.contracts[0]!.id : ''}
                      >
                        <option value="">Sem vínculo específico</option>
                        {data.contracts.map((contract) => (
                          <option value={contract.id} key={contract.id}>
                            {contract.number} · {contract.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="section-note form-wide">
                    As parcelas são divididas em centavos e distribuídas mensalmente a partir do
                    primeiro vencimento.
                  </p>
                  <button className="primary form-wide" disabled={saving}>
                    {saving ? 'Salvando…' : 'Salvar cobrança'}
                  </button>
                </form>
              )}
            </>
          )}
          {!canViewReceivables ? (
            <p className="section-note">
              Você não tem permissão para consultar o financeiro deste cliente.
            </p>
          ) : data.financial.receivables.length ? (
            <div className="table-wrap embedded-table">
              <table>
                <thead>
                  <tr>
                    <th>Referência</th>
                    <th>Valor original</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.financial.receivables.map((item) => (
                    <tr key={item.id}>
                      <td>{item.reference}</td>
                      <td>{formatMoney(item.originalAmount, item.currency)}</td>
                      <td>{formatDate(item.dueDate)}</td>
                      <td>
                        <span className="badge">{item.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="section-note">Ainda não há cobranças ou recebimentos vinculados.</p>
          )}
          {guidedOnboarding && onboardingStep === 2 && (
            <div className="client-onboarding-actions">
              <button className="secondary" type="button" onClick={() => moveToOnboardingStep(1)}>
                Voltar ao cadastro
              </button>
              <button className="primary" type="button" onClick={() => moveToOnboardingStep(3)}>
                Continuar para honorários
              </button>
            </div>
          )}
        </ClientPanel>
      )}

      {(!guidedOnboarding || onboardingStep === 3) && (
        <ClientPanel id="honorarios-cliente" title="Contrato de honorários">
          {canViewContracts && data.contracts.length ? (
            <div className="record-list">
              {data.contracts.map((contract) => {
                const savedScans = data.documents.filter(
                  (document) =>
                    document.category === 'CONTRATO_HONORARIOS' &&
                    document.contractId === contract.id &&
                    !document.title.startsWith('Gerado automaticamente ·'),
                );
                return (
                  <article key={contract.id}>
                    <strong>
                      {contract.number} · {contract.title}
                    </strong>
                    <span>
                      {feeModelLabel(contract.feeModel)} ·{' '}
                      {contract.feeModel === 'SUCCESS'
                        ? `${formatSuccessRate(contract.successRate)}% do êxito`
                        : formatMoney(contract.fixedAmount, contract.currency)}
                      {contract.feeModel === 'MIXED' && contract.successRate
                        ? ` + ${formatSuccessRate(contract.successRate)}% do êxito`
                        : ''}{' '}
                      · {contract.status}
                    </span>
                    {(contract.terms?.services?.length || contract.serviceName) && (
                      <small>
                        Serviços: {contract.terms?.services?.join(', ') ?? contract.serviceName}
                      </small>
                    )}
                    {savedScans.length > 0 && (
                      <small>
                        {savedScans.length === 1
                          ? '1 contrato assinado ou digitalizado salvo'
                          : `${savedScans.length} arquivos assinados ou digitalizados salvos`}
                      </small>
                    )}
                  </article>
                );
              })}
            </div>
          ) : canViewContracts ? (
            <p className="section-note">Nenhum contrato cadastrado para este cliente.</p>
          ) : null}
          <p className="section-note">
            Os modelos gerados usam os dados atuais do cliente, os honorários e a cobrança
            vinculada.
          </p>
          {canCreateContract && (
            <>
              <button
                className="secondary"
                type="button"
                aria-expanded={showContractForm}
                onClick={() => {
                  setShowContractForm((value) => !value);
                  setContractFeeModel('FIXED');
                  setContractHearings([]);
                }}
              >
                {showContractForm ? 'Fechar formulário' : 'Novo contrato de honorários'}
              </button>
              {showContractForm && (
                <form className="form-grid compact-form contract-entry" onSubmit={createContract}>
                  <label>
                    Número do contrato
                    <input name="number" required maxLength={80} />
                  </label>
                  <label>
                    Nome do contrato
                    <input
                      name="title"
                      required
                      minLength={2}
                      defaultValue={`Honorários — ${data.client.displayName}`}
                    />
                  </label>
                  <label>
                    Modelo de honorários
                    <select
                      name="feeModel"
                      value={contractFeeModel}
                      onChange={(event) => setContractFeeModel(event.target.value)}
                    >
                      <option value="FIXED">Valor fixo</option>
                      <option value="HOURLY">Por hora</option>
                      <option value="SUCCESS">Êxito</option>
                      <option value="MIXED">Misto</option>
                    </select>
                  </label>
                  {contractFeeModel !== 'SUCCESS' && (
                    <label>
                      {contractFeeModel === 'HOURLY' ? 'Valor por hora (R$)' : 'Valor fixo (R$)'}
                      <input
                        name="fixedAmount"
                        inputMode="decimal"
                        placeholder="1.500,00"
                        required
                      />
                    </label>
                  )}
                  {(contractFeeModel === 'SUCCESS' || contractFeeModel === 'MIXED') && (
                    <label>
                      Percentual de êxito
                      <input
                        name="successRate"
                        inputMode="decimal"
                        placeholder="Ex.: 15"
                        required
                      />
                    </label>
                  )}
                  <ServiceSelection disabled={saving} />
                  <ContractHearings disabled={saving} onChange={setContractHearings} />
                  {canViewReceivables && (
                    <label className="form-wide">
                      Cobrança deste contrato
                      <select name="receivableId" defaultValue="">
                        <option value="">Sem cobrança vinculada</option>
                        {data.financial.receivables
                          .filter((receivable) => !receivable.contractId)
                          .map((receivable) => (
                            <option key={receivable.id} value={receivable.id}>
                              {receivable.reference} ·{' '}
                              {formatMoney(receivable.originalAmount, receivable.currency)} ·{' '}
                              {receivable.installments.length} parcela(s)
                            </option>
                          ))}
                      </select>
                      <span className="section-note">
                        A cobrança selecionada preencherá valores e vencimentos do contrato.
                      </span>
                    </label>
                  )}
                  <label>
                    Início da vigência (opcional)
                    <input name="startsAt" type="date" />
                  </label>
                  <label>
                    Fim da vigência (opcional)
                    <input name="endsAt" type="date" />
                  </label>
                  <button className="primary form-wide" disabled={saving}>
                    {saving ? 'Salvando…' : 'Salvar contrato'}
                  </button>
                </form>
              )}
            </>
          )}
          {guidedOnboarding && onboardingStep === 3 && (
            <div className="client-onboarding-actions">
              <button className="secondary" type="button" onClick={() => moveToOnboardingStep(2)}>
                Voltar ao financeiro
              </button>
              <button className="primary" type="button" onClick={() => moveToOnboardingStep(4)}>
                Continuar para documentos
              </button>
            </div>
          )}
        </ClientPanel>
      )}

      <div className="client-grid">
        {(!guidedOnboarding || onboardingStep === 4) && (
          <ClientPanel id="documentos-cliente" title="Documentos do cliente">
            <p className="section-note">
              Gere procuração, contrato e declaração já preenchidos com os dados atuais. Cada
              emissão fica salva no histórico como uma versão interna.
            </p>
            {canUpload && (
              <section className="contract-scan-upload" aria-labelledby="saved-contract-heading">
                <h3 id="saved-contract-heading">Salvar contrato assinado ou digitalizado</h3>
                <p className="section-note">
                  Guarde aqui os contratos que o escritório já possui em PDF ou imagem. O arquivo
                  fica privado e pode ser relacionado a um contrato cadastrado. Repita o envio para
                  cada contrato que quiser arquivar.
                </p>
                <form className="stack-form compact-form" onSubmit={uploadExistingContract}>
                  {canViewContracts && data.contracts.length > 0 && (
                    <label>
                      Contrato cadastrado (opcional)
                      <select name="contractId" defaultValue="">
                        <option value="">Salvar somente na ficha do cliente</option>
                        {data.contracts.map((contract) => (
                          <option value={contract.id} key={contract.id}>
                            {contract.number} · {contract.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Arquivo do contrato
                    <input
                      name="file"
                      required
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                    />
                  </label>
                  <button className="secondary" disabled={saving}>
                    {saving ? 'Salvando…' : 'Guardar contrato'}
                  </button>
                </form>
              </section>
            )}
            <div className="document-checklist">
              {documentTypes.map((required) => {
                const matchingDocuments = data.documents.filter(
                  (document) => document.category === required.category,
                );
                const generatedCount = matchingDocuments.filter((document) =>
                  document.title.startsWith('Gerado automaticamente ·'),
                ).length;
                const attachedCount = matchingDocuments.length - generatedCount;
                return (
                  <div className="document-check-item" key={required.category}>
                    <span>
                      <strong>{required.label}</strong>
                      <small>
                        {canViewDocuments
                          ? matchingDocuments.length
                            ? [
                                generatedCount
                                  ? generatedCount === 1
                                    ? '1 modelo gerado'
                                    : `${generatedCount} modelos gerados`
                                  : '',
                                attachedCount ? `${attachedCount} arquivo(s) anexado(s)` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : 'Pendente'
                          : 'Consulta de documentos indisponível'}
                      </small>
                    </span>
                    <b className={matchingDocuments.length ? 'badge badge-done' : 'badge'}>
                      {canViewDocuments
                        ? matchingDocuments.length
                          ? 'Concluído'
                          : 'Pendente'
                        : '—'}
                    </b>
                  </div>
                );
              })}
            </div>
            <div className="record-list">
              {data.documents.map((item) => (
                <button
                  className="record-button"
                  key={item.id}
                  onClick={() => void openDocument(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.category || 'Documento'} ·{' '}
                    {item.visibility === 'CLIENT' ? 'visível ao cliente' : 'interno'}
                    {item.contractId
                      ? ` · ${data.contracts.find((contract) => contract.id === item.contractId)?.number ?? 'contrato relacionado'}`
                      : ''}
                  </span>
                </button>
              ))}
            </div>
            {canUpload && (
              <div className="stack-form compact-form document-generation">
                <label>
                  Documento para gerar
                  <select
                    aria-label="Documento para gerar"
                    value={documentCategory}
                    onChange={(event) => {
                      const nextCategory = event.target.value;
                      setDocumentCategory(nextCategory);
                      setDocumentTitle(
                        documentTypes.find((item) => item.category === nextCategory)?.label ??
                          'Documento do cliente',
                      );
                    }}
                  >
                    {documentTypes.map((item) => (
                      <option key={item.category} value={item.category}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {documentCategory === 'CONTRATO_HONORARIOS' && canViewContracts && (
                  <label>
                    Honorários cadastrados
                    <select
                      key={data.contracts.length}
                      value={documentContractId}
                      onChange={(event) => setDocumentContractId(event.target.value)}
                    >
                      <option value="">Selecione o contrato</option>
                      {data.contracts.map((contract) => (
                        <option value={contract.id} key={contract.id}>
                          {contract.number} · {contract.title} ·{' '}
                          {formatMoney(contract.fixedAmount, contract.currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="section-note">
                  {data.client.type === 'COMPANY'
                    ? 'Confira CNPJ, endereço e nome e CPF do representante legal.'
                    : 'Confira CPF e endereço. Nacionalidade, estado civil, profissão e RG são incluídos quando cadastrados.'}{' '}
                  Um administrador precisa configurar a identidade do escritório antes da primeira
                  procuração ou contrato.
                </p>
                <button
                  className="primary"
                  type="button"
                  disabled={
                    saving ||
                    (documentCategory === 'CONTRATO_HONORARIOS' &&
                      (!documentContractId || !canViewReceivables))
                  }
                  onClick={generateClientDocument}
                >
                  {saving ? 'Gerando…' : `Gerar ${documentTitle.toLowerCase()}`}
                </button>
              </div>
            )}
            {canUpload && (
              <details className="optional-fields">
                <summary>Anexar um arquivo já pronto</summary>
                <form className="stack-form compact-form" onSubmit={uploadClientDocument}>
                  <label>
                    Tipo de documento
                    <select
                      name="category"
                      value={attachedDocumentCategory}
                      onChange={(event) => {
                        const nextCategory = event.target.value;
                        setAttachedDocumentCategory(nextCategory);
                        setAttachedDocumentTitle(
                          attachableDocumentTypes.find((item) => item.category === nextCategory)
                            ?.label ?? 'Documento do cliente',
                        );
                      }}
                    >
                      {attachableDocumentTypes.map((item) => (
                        <option key={item.category} value={item.category}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Nome do documento
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={240}
                      value={attachedDocumentTitle}
                      onChange={(event) => setAttachedDocumentTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    Arquivo
                    <input
                      name="file"
                      required
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,.docx"
                    />
                  </label>
                  <button className="secondary" disabled={saving}>
                    Anexar documento
                  </button>
                </form>
              </details>
            )}
          </ClientPanel>
        )}

        {!guidedOnboarding && (
          <ClientPanel title="Observações para o cliente">
            <p className="section-note">Este conteúdo fica visível no portal do cliente.</p>
            {canMessage && (
              <form className="stack-form" onSubmit={(event) => addText(event, 'message')}>
                <label>
                  Nova observação
                  <textarea name="body" required maxLength={20000} rows={4} />
                </label>
                <button className="primary" disabled={saving}>
                  Publicar observação
                </button>
              </form>
            )}
            <div className="record-list">
              {data.clientMessages.map((item) => (
                <article key={item.id}>
                  <strong>{formatDate(item.publishedAt)}</strong>
                  <span>{item.body}</span>
                </article>
              ))}
            </div>
          </ClientPanel>
        )}
      </div>

      {guidedOnboarding && onboardingStep === 4 && (
        <div className="client-onboarding-actions">
          <button className="secondary" type="button" onClick={() => moveToOnboardingStep(3)}>
            Voltar aos honorários
          </button>
          <button className="primary" type="button" onClick={finishGuidedOnboarding}>
            Concluir por agora
          </button>
        </div>
      )}

      {!guidedOnboarding && (
        <ClientPanel title="Notas internas da equipe">
          <p className="section-note">Nunca são exibidas ao cliente.</p>
          {canNote && (
            <form className="inline-note" onSubmit={(event) => addText(event, 'note')}>
              <label className="sr-only" htmlFor="internal-note">
                Nova nota interna
              </label>
              <textarea
                id="internal-note"
                name="body"
                required
                rows={3}
                placeholder="Registre uma informação interna…"
              />
              <button className="secondary" disabled={saving}>
                Salvar nota
              </button>
            </form>
          )}
          <div className="record-list">
            {data.internalNotes.map((item) => (
              <article key={item.id}>
                <strong>{formatDate(item.createdAt)}</strong>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
        </ClientPanel>
      )}
    </section>
  );
}
