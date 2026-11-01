'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';
import { ReceiptCapture } from '../finance/receipt-capture';

type Message = { id: string; body: string; publishedAt: string };
type DocumentItem = {
  id: string;
  title: string;
  category?: string;
  updatedAt: string;
  visibility: string;
  versions?: Array<{ fileName: string }>;
};
type PortalReceivable = {
  id: string;
  reference: string;
  installments: Array<{ id: string; sequence: number; status: string }>;
};
type PortalReceipt = { id: string; status: string; document?: { title: string } };

export function ClientPortal({
  clientId,
  permissions,
}: {
  clientId: string;
  permissions: readonly string[];
}) {
  const messages = useApiData<Message[]>(`/client-messages?clientId=${clientId}`);
  const documents = usePaginatedData<DocumentItem>(
    permissions.includes('documents:view') ? `/documents?clientId=${clientId}` : undefined,
  );
  const receivables = usePaginatedData<PortalReceivable>(
    permissions.includes('receipts:create') && permissions.includes('receivables:view')
      ? '/finance/receivables'
      : undefined,
  );
  const receipts = usePaginatedData<PortalReceipt>(
    permissions.includes('receipts:view') ? '/finance/receipts' : undefined,
  );
  const [selectedInstallment, setSelectedInstallment] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canMessage = permissions.includes('messages:create');

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const body = new FormData(target).get('body');
    setBusy(true);
    setFeedback(undefined);
    try {
      await api('/client-messages', {
        method: 'POST',
        body: JSON.stringify({ clientId, body }),
      });
      setFeedback('Mensagem enviada à equipe.');
      target.reset();
      messages.reload();
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'mensagem não enviada'}`);
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (id: string) => {
    setFeedback(undefined);
    try {
      const result = await api<{ url: string }>(`/documents/${id}/download-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'arquivo indisponível'}`);
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Portal do cliente</p>
          <h1>Minha área</h1>
          <span>
            Acompanhe as observações do escritório e acesse seus comprovantes e documentos.
          </span>
        </div>
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
        <section className="surface client-panel">
          <h2>Mensagens e observações</h2>
          {canMessage && (
            <form className="stack-form" onSubmit={send}>
              <label>
                Responder ao escritório
                <textarea required maxLength={20_000} rows={4} name="body" />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar mensagem'}
              </button>
            </form>
          )}
          {messages.error && (
            <div role="alert" className="notice notice-error">
              {messages.error.message}
            </div>
          )}
          <div className="record-list">
            {messages.data?.map((message) => (
              <article key={message.id}>
                <strong>{formatDate(message.publishedAt)}</strong>
                <span>{message.body}</span>
              </article>
            ))}
          </div>
          {messages.data && !messages.data.length && (
            <div className="empty">
              <strong>Nenhuma mensagem</strong>
              <span>As observações do escritório aparecerão aqui.</span>
            </div>
          )}
        </section>
        <section className="surface client-panel">
          <h2>Comprovantes e documentos</h2>
          {permissions.includes('receipts:create') && (
            <div className="stack-form">
              <h3>Enviar comprovante de uma cobrança</h3>
              <p>
                O envio não marca a cobrança como paga. O financeiro analisará o arquivo e a
                operação.
              </p>
              <label>
                Parcela
                <select
                  value={selectedInstallment}
                  onChange={(event) => setSelectedInstallment(event.target.value)}
                >
                  <option value="">Selecione uma parcela</option>
                  {receivables.data?.items.flatMap((receivable) =>
                    receivable.installments
                      .filter(
                        (installment) =>
                          !['PAID', 'CANCELLED', 'RENEGOTIATED'].includes(installment.status),
                      )
                      .map((installment) => (
                        <option key={installment.id} value={installment.id}>
                          {receivable.reference} · parcela {installment.sequence}
                        </option>
                      )),
                  )}
                </select>
              </label>
              {receivables.loading && <p role="status">Carregando cobranças…</p>}
              {receivables.error && <p role="alert">{receivables.error.message}</p>}
              {receivables.data && (
                <LoadMore
                  shown={receivables.data.items.length}
                  total={receivables.data.total}
                  loading={receivables.loading}
                  error={receivables.error}
                  onLoad={receivables.loadMore}
                  onRetry={receivables.retry}
                />
              )}
              {selectedInstallment && (
                <ReceiptCapture
                  key={selectedInstallment}
                  installmentId={selectedInstallment}
                  onChanged={() => {
                    receipts.reload();
                    documents.reload();
                  }}
                />
              )}
              {receipts.data?.items.length ? (
                <div className="record-list">
                  {receipts.data.items.map((receipt) => (
                    <p key={receipt.id}>
                      {receipt.document?.title ?? 'Comprovante'} · {receipt.status}
                    </p>
                  ))}
                </div>
              ) : null}
              {receipts.data && (
                <LoadMore
                  shown={receipts.data.items.length}
                  total={receipts.data.total}
                  loading={receipts.loading}
                  error={receipts.error}
                  onLoad={receipts.loadMore}
                  onRetry={receipts.retry}
                />
              )}
            </div>
          )}
          {documents.error && !documents.data && (
            <div role="alert" className="notice notice-error">
              {documents.error.message}{' '}
              <button type="button" onClick={documents.retry}>
                Tentar novamente
              </button>
            </div>
          )}
          <div className="record-list">
            {documents.data?.items.map((document) => (
              <button
                className="record-button"
                key={document.id}
                onClick={() => void openDocument(document.id)}
              >
                <strong>{document.title}</strong>
                <span>
                  {document.category ?? 'Documento'} ·{' '}
                  {document.versions?.[0]?.fileName ?? 'arquivo privado'}
                </span>
                <small>{formatDate(document.updatedAt)}</small>
              </button>
            ))}
          </div>
          {documents.data && !documents.data.items.length && (
            <div className="empty">
              <strong>Nenhum documento</strong>
              <span>Os arquivos liberados pelo escritório aparecerão aqui.</span>
            </div>
          )}
          {documents.data && (
            <LoadMore
              shown={documents.data.items.length}
              total={documents.data.total}
              loading={documents.loading}
              error={documents.error}
              onLoad={documents.loadMore}
              onRetry={documents.retry}
            />
          )}
        </section>
      </div>
    </section>
  );
}
