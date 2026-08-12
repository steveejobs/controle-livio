'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Page<T> = { items: T[]; total: number };
type Client = { id: string; displayName: string };
type DocumentItem = {
  id: string;
  title: string;
  category?: string;
  visibility: string;
  updatedAt: string;
  versions?: Array<{ id: string; fileName: string; createdAt: string }>;
  client?: Client;
};

export function Documents({ permissions }: { permissions: readonly string[] }) {
  const documents = useApiData<Page<DocumentItem>>('/documents?pageSize=100');
  const clients = useApiData<Page<Client>>(
    permissions.includes('clients:view') ? '/clients?pageSize=100' : undefined,
  );
  const [showUpload, setShowUpload] = useState(false);
  const [versionFor, setVersionFor] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canCreate = permissions.includes('documents:create');
  const canUpdate = permissions.includes('documents:update');

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      documents.reload();
      return true;
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'operação não concluída'}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const source = new FormData(target);
    const payload = new FormData();
    for (const name of ['file', 'title', 'category', 'visibility', 'clientId']) {
      const value = source.get(name);
      if (value) payload.set(name, value);
    }
    void perform(
      () => api('/documents', { method: 'POST', body: payload }),
      'Documento enviado com segurança.',
    ).then((ok) => {
      if (ok) {
        target.reset();
        setShowUpload(false);
      }
    });
  };

  const addVersion = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault();
    const target = event.currentTarget;
    const payload = new FormData(target);
    void perform(
      () => api(`/documents/${id}/versions`, { method: 'POST', body: payload }),
      'Nova versão adicionada.',
    ).then((ok) => {
      if (ok) setVersionFor(undefined);
    });
  };

  const open = async (id: string) => {
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
          <p>Arquivos</p>
          <h1>Documentos</h1>
          <span>Envio privado, download temporário e histórico de versões.</span>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setShowUpload((value) => !value)}>
            {showUpload ? 'Fechar' : 'Enviar documento'}
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
      {showUpload && canCreate && (
        <form className="surface form-grid" onSubmit={upload}>
          <label>
            Título
            <input required minLength={2} name="title" />
          </label>
          <label>
            Categoria
            <input name="category" maxLength={120} />
          </label>
          <label>
            Visibilidade
            <select name="visibility" defaultValue="INTERNAL">
              <option value="INTERNAL">Somente equipe</option>
              <option value="CLIENT">Visível ao cliente</option>
            </select>
          </label>
          {clients.data && (
            <label>
              Cliente
              <select name="clientId" defaultValue="">
                <option value="">Sem vínculo</option>
                {clients.data.items.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-wide">
            Arquivo
            <input
              required
              type="file"
              name="file"
              accept="application/pdf,image/png,image/jpeg,.docx"
            />
          </label>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar documento'}
          </button>
        </form>
      )}
      {documents.error && (
        <div role="alert" className="notice notice-error">
          {documents.error.message} <button onClick={documents.reload}>Tentar novamente</button>
        </div>
      )}
      {!documents.data && !documents.error ? (
        <div className="loading" aria-label="Carregando documentos">
          <i />
          <i />
          <i />
        </div>
      ) : documents.data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Categoria</th>
                <th>Visibilidade</th>
                <th>Atualizado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {documents.data.items.map((document) => (
                <tr key={document.id}>
                  <td>
                    <strong>{document.title}</strong>
                    <small>{document.versions?.[0]?.fileName}</small>
                  </td>
                  <td>{document.client?.displayName ?? '—'}</td>
                  <td>{document.category ?? '—'}</td>
                  <td>{document.visibility === 'CLIENT' ? 'Cliente' : 'Interno'}</td>
                  <td>{formatDate(document.updatedAt)}</td>
                  <td>
                    <button className="table-action" onClick={() => void open(document.id)}>
                      Abrir
                    </button>
                    {canUpdate && (
                      <button
                        className="table-action"
                        onClick={() =>
                          setVersionFor(versionFor === document.id ? undefined : document.id)
                        }
                      >
                        Nova versão
                      </button>
                    )}
                    {versionFor === document.id && (
                      <form
                        className="inline-note"
                        onSubmit={(event) => addVersion(event, document.id)}
                      >
                        <input
                          aria-label={`Nova versão de ${document.title}`}
                          required
                          type="file"
                          name="file"
                          accept="application/pdf,image/png,image/jpeg,.docx"
                        />
                        <button className="secondary" disabled={busy}>
                          Enviar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum documento</strong>
          <span>Envie o primeiro arquivo para começar.</span>
        </div>
      )}
    </section>
  );
}
