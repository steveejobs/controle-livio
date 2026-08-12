'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatMoney } from '../shared/format';
import { useApiData } from '../shared/use-api-data';
import type { ClientOverview } from './client.types';

function ClientPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface client-panel" data-reveal>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function ClientDetail({
  clientId,
  onBack,
  permissions,
}: {
  clientId: string;
  onBack: () => void;
  permissions: readonly string[];
}) {
  const { data, error, reload } = useApiData<ClientOverview>(`/clients/${clientId}/overview`);
  const [feedback, setFeedback] = useState<string>();
  const [saving, setSaving] = useState(false);
  const canUpdateClient = permissions.includes('clients:update');
  const canAddContact = permissions.includes('clients:create');
  const canUpload = permissions.includes('documents:create');
  const canMessage = permissions.includes('messages:create');
  const canNote = permissions.includes('notes:create');

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
          }),
        }),
      'Cadastro atualizado.',
    );
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

  const uploadReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const source = new FormData(target);
    const file = source.get('file');
    if (!(file instanceof File) || !file.size) return;
    const payload = new FormData();
    payload.set('file', file);
    payload.set('title', String(source.get('title')));
    payload.set('category', 'COMPROVANTE');
    payload.set('visibility', source.get('visibility') === 'CLIENT' ? 'CLIENT' : 'INTERNAL');
    payload.set('clientId', clientId);
    const paymentId = String(source.get('paymentId') || '');
    if (paymentId) payload.set('paymentId', paymentId);
    void run(
      () => api('/documents', { method: 'POST', body: payload }),
      'Comprovante anexado.',
    ).then((succeeded) => {
      if (succeeded) target.reset();
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
        <div>
          <p>Cliente</p>
          <h1>{data.client.displayName}</h1>
          <span>Cadastro, contatos, financeiro, comprovantes e comunicação em um só lugar.</span>
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

      <div className="client-grid">
        <ClientPanel title="Dados do cliente">
          <form className="stack-form" onSubmit={edit}>
            <label>
              Nome
              <input
                name="displayName"
                required
                disabled={!canUpdateClient}
                defaultValue={data.client.displayName}
              />
            </label>
            <label>
              Razão social
              <input
                name="legalName"
                disabled={!canUpdateClient}
                defaultValue={data.client.legalName}
              />
            </label>
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
              Origem
              <input name="source" disabled={!canUpdateClient} defaultValue={data.client.source} />
            </label>
            {canUpdateClient && (
              <button className="primary" disabled={saving}>
                Salvar alterações
              </button>
            )}
          </form>
        </ClientPanel>

        <ClientPanel title="Contatos">
          <div className="record-list">
            {data.contacts.map((item) => (
              <article key={item.id}>
                <strong>
                  {item.name}
                  {item.isPrimary ? ' · principal' : ''}
                </strong>
                <span>
                  {item.role || 'Contato'} · {item.email || item.phone || 'Sem canal informado'}
                </span>
              </article>
            ))}
          </div>
          {canAddContact && (
            <form className="stack-form compact-form" onSubmit={addContact}>
              <label>
                Nome
                <input required name="name" />
              </label>
              <label>
                Função
                <input name="role" />
              </label>
              <label>
                E-mail
                <input name="email" type="email" />
              </label>
              <label>
                Telefone
                <input name="phone" />
              </label>
              <label className="check">
                <input name="isPrimary" type="checkbox" /> Contato principal
              </label>
              <button className="secondary" disabled={saving}>
                Adicionar contato
              </button>
            </form>
          )}
        </ClientPanel>
      </div>

      <ClientPanel title="Financeiro do cliente">
        <div className="summary-strip">
          <span>
            <b>{data.financial.receivables.length}</b> recebíveis
          </span>
          <span>
            <b>{data.financial.payments.length}</b> pagamentos
          </span>
          <span>
            <b>{data.documents.length}</b> documentos
          </span>
        </div>
        <div className="table-wrap embedded-table">
          <table>
            <thead>
              <tr>
                <th>Referência</th>
                <th>Valor</th>
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
      </ClientPanel>

      <div className="client-grid">
        <ClientPanel title="Comprovantes e documentos">
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
                </span>
              </button>
            ))}
          </div>
          {canUpload && (
            <form className="stack-form compact-form" onSubmit={uploadReceipt}>
              <label>
                Título
                <input name="title" required placeholder="Comprovante de pagamento" />
              </label>
              <label>
                Pagamento
                <select name="paymentId" defaultValue="">
                  <option value="">Sem vínculo específico</option>
                  {data.financial.payments.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.reference} · {formatMoney(item.amount, item.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Visibilidade
                <select name="visibility" defaultValue="CLIENT">
                  <option value="CLIENT">Cliente pode visualizar</option>
                  <option value="INTERNAL">Somente equipe</option>
                </select>
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
                Anexar comprovante
              </button>
            </form>
          )}
        </ClientPanel>

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
      </div>

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
    </section>
  );
}
