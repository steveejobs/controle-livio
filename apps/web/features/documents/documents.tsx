'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';
import { DocumentTemplateEditor } from './document-template-editor';
import { normalizeWhatsAppPhone } from '../clients/whatsapp-collection';

type Client = { id: string; displayName: string };
type DocumentItem = {
  id: string;
  title: string;
  category?: string;
  visibility: string;
  updatedAt: string;
  versions?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    version: number;
    createdAt: string;
  }>;
  signingRequests?: Array<{
    id: string;
    signerName: string;
    status: string;
    expiresAt: string;
    signedAt?: string;
  }>;
  client?: Client;
};

type SignatureShare = {
  link: string;
  signerName: string;
  title: string;
  email?: string | null;
  phone?: string | null;
};

type OfficeSettings = {
  attorneyName: string;
  professionalRegistration: string;
  officeAddress: string;
  jurisdiction: string;
  paymentInstructions?: string;
};

export function Documents({
  permissions,
  isAdministrator,
}: {
  permissions: readonly string[];
  isAdministrator: boolean;
}) {
  const documents = usePaginatedData<DocumentItem>('/documents');
  const clients = usePaginatedData<Client>(
    permissions.includes('clients:view') ? '/clients' : undefined,
    100,
  );
  const [showUpload, setShowUpload] = useState(false);
  const [versionFor, setVersionFor] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>({
    attorneyName: '',
    professionalRegistration: '',
    officeAddress: '',
    jurisdiction: '',
    paymentInstructions: '',
  });
  const [settingsFeedback, setSettingsFeedback] = useState<string>();
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [signatureFor, setSignatureFor] = useState<DocumentItem>();
  const [signatureShare, setSignatureShare] = useState<SignatureShare>();
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [signatureFeedback, setSignatureFeedback] = useState<string>();
  const canCreate = permissions.includes('documents:create');
  const canRequestSignature = canCreate && permissions.includes('clients:view');
  const canUpdate = permissions.includes('documents:update');
  const canManageSettings = isAdministrator && permissions.includes('organization:update');
  const signatureWhatsApp = signatureShare?.phone
    ? normalizeWhatsAppPhone(signatureShare.phone)
    : null;

  useEffect(() => {
    if (!canManageSettings) return;
    let active = true;
    void api<{ settings: OfficeSettings | null }>('/documents/office-settings')
      .then((result) => {
        if (active && result.settings) setOfficeSettings(result.settings);
      })
      .catch((error: unknown) => {
        if (active)
          setSettingsFeedback(
            error instanceof ApiError
              ? error.message
              : 'Não foi possível carregar os dados do escritório.',
          );
      });
    return () => {
      active = false;
    };
  }, [canManageSettings]);

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

  const saveOfficeSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSettingsBusy(true);
    setSettingsFeedback(undefined);
    void api<{ settings: OfficeSettings }>('/documents/office-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        attorneyName: String(form.get('attorneyName') || '').trim(),
        professionalRegistration: String(form.get('professionalRegistration') || '').trim(),
        officeAddress: String(form.get('officeAddress') || '').trim(),
        jurisdiction: String(form.get('jurisdiction') || '').trim(),
        paymentInstructions: String(form.get('paymentInstructions') || '').trim() || undefined,
      }),
    })
      .then((result) => {
        setOfficeSettings(result.settings);
        setSettingsFeedback('Dados do escritório salvos para as próximas emissões.');
      })
      .catch((error: unknown) => {
        setSettingsFeedback(
          `Erro: ${error instanceof ApiError ? error.message : 'não foi possível salvar os dados do escritório.'}`,
        );
      })
      .finally(() => setSettingsBusy(false));
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

  const createSignatureRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signatureFor) return;
    const form = new FormData(event.currentTarget);
    setSignatureBusy(true);
    setSignatureFeedback(undefined);
    try {
      const result = await api<{
        token: string;
        signerName: string;
        documentTitle: string;
        client: { email?: string | null; phone?: string | null };
      }>(`/documents/${signatureFor.id}/signature-requests`, {
        method: 'POST',
        body: JSON.stringify({
          signerName: String(form.get('signerName') ?? '').trim() || undefined,
          expiresInDays: Number(form.get('expiresInDays') ?? 7),
        }),
      });
      const link = new URL(`/assinar/${result.token}`, window.location.origin).toString();
      setSignatureShare({
        link,
        signerName: result.signerName,
        title: result.documentTitle,
        email: result.client.email,
        phone: result.client.phone,
      });
      setSignatureFeedback(undefined);
      setSignatureFor(undefined);
      documents.reload();
    } catch (caught) {
      setSignatureFeedback(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível criar o link de assinatura.',
      );
    } finally {
      setSignatureBusy(false);
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
      {signatureFeedback && (
        <div role="alert" className="notice notice-error">
          {signatureFeedback}
        </div>
      )}
      {canManageSettings && (
        <details className="surface optional-fields document-office-settings">
          <summary>Dados do escritório nos documentos</summary>
          <p className="section-note">
            Defina estes dados uma vez. Contratos e procurações novos usam esta identidade; versões
            já emitidas ficam preservadas.
          </p>
          {settingsFeedback && (
            <div
              role={settingsFeedback.startsWith('Erro:') ? 'alert' : 'status'}
              className={
                settingsFeedback.startsWith('Erro:')
                  ? 'notice notice-error'
                  : 'notice notice-success'
              }
            >
              {settingsFeedback}
            </div>
          )}
          <form className="form-grid compact-form" onSubmit={saveOfficeSettings}>
            <label>
              Nome profissional
              <input
                required
                minLength={3}
                maxLength={200}
                name="attorneyName"
                value={officeSettings.attorneyName}
                onChange={(event) =>
                  setOfficeSettings({ ...officeSettings, attorneyName: event.target.value })
                }
              />
            </label>
            <label>
              Inscrições na OAB
              <input
                required
                minLength={3}
                maxLength={120}
                name="professionalRegistration"
                placeholder="OAB/UF 00000"
                value={officeSettings.professionalRegistration}
                onChange={(event) =>
                  setOfficeSettings({
                    ...officeSettings,
                    professionalRegistration: event.target.value,
                  })
                }
              />
            </label>
            <label className="form-wide">
              Endereço profissional
              <input
                required
                minLength={8}
                maxLength={500}
                name="officeAddress"
                value={officeSettings.officeAddress}
                onChange={(event) =>
                  setOfficeSettings({ ...officeSettings, officeAddress: event.target.value })
                }
              />
            </label>
            <label>
              Foro
              <input
                required
                minLength={3}
                maxLength={160}
                name="jurisdiction"
                placeholder="Cidade/UF"
                value={officeSettings.jurisdiction}
                onChange={(event) =>
                  setOfficeSettings({ ...officeSettings, jurisdiction: event.target.value })
                }
              />
            </label>
            <label className="form-wide">
              Instruções de pagamento (opcional)
              <textarea
                maxLength={1000}
                name="paymentInstructions"
                rows={2}
                value={officeSettings.paymentInstructions ?? ''}
                onChange={(event) =>
                  setOfficeSettings({ ...officeSettings, paymentInstructions: event.target.value })
                }
              />
            </label>
            <button className="primary form-wide" disabled={settingsBusy}>
              {settingsBusy ? 'Salvando…' : 'Salvar dados do escritório'}
            </button>
          </form>
        </details>
      )}
      {canManageSettings && <DocumentTemplateEditor />}
      {showUpload && canCreate && (
        <form className="surface form-grid" onSubmit={upload}>
          <label>
            Nome do documento
            <input required minLength={2} name="title" />
          </label>
          <label>
            Tipo de documento (opcional)
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
      {documents.error && !documents.data && (
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
                    {document.signingRequests?.[0] && (
                      <small className="document-sign-status">
                        {document.signingRequests[0].status === 'SIGNED'
                          ? `Assinado por ${document.signingRequests[0].signerName}`
                          : document.signingRequests[0].status === 'PENDING'
                            ? `Aguardando ${document.signingRequests[0].signerName}`
                            : `Assinatura ${document.signingRequests[0].status.toLowerCase()}`}
                      </small>
                    )}
                  </td>
                  <td>{document.client?.displayName ?? '—'}</td>
                  <td>{document.category ?? '—'}</td>
                  <td>{document.visibility === 'CLIENT' ? 'Cliente' : 'Interno'}</td>
                  <td>{formatDate(document.updatedAt)}</td>
                  <td>
                    <button className="table-action" onClick={() => void open(document.id)}>
                      Abrir
                    </button>
                    {canRequestSignature &&
                      document.versions?.[0]?.mimeType === 'application/pdf' && (
                        <button className="table-action" onClick={() => setSignatureFor(document)}>
                          Solicitar assinatura
                        </button>
                      )}
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
                    {canUpdate && document.signingRequests?.[0]?.status === 'PENDING' && (
                      <button
                        className="table-action"
                        onClick={() =>
                          void perform(
                            () =>
                              api(
                                `/documents/signature-requests/${document.signingRequests![0]!.id}/revoke`,
                                {
                                  method: 'POST',
                                },
                              ),
                            'Link de assinatura cancelado.',
                          )
                        }
                      >
                        Cancelar link
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
      {signatureFor && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSignatureFor(undefined);
          }}
        >
          <section
            className="surface signature-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signature-request-title"
          >
            <header className="dialog-heading">
              <div>
                <p>Assinatura online</p>
                <h2 id="signature-request-title">Enviar para assinatura</h2>
              </div>
              <button
                className="table-action"
                type="button"
                onClick={() => setSignatureFor(undefined)}
                aria-label="Fechar"
              >
                Fechar
              </button>
            </header>
            <p>
              <strong>{signatureFor.title}</strong>
            </p>
            <p className="section-note">
              O cliente abrirá uma página segura para conferir o PDF e assinar com o dedo, mouse ou
              nome digitado.
            </p>
            <form className="form-grid" onSubmit={(event) => void createSignatureRequest(event)}>
              <label className="form-wide">
                Nome de quem assinará
                <input
                  name="signerName"
                  minLength={3}
                  maxLength={200}
                  placeholder="Em pessoa jurídica, informe o representante legal"
                />
              </label>
              <label>
                Validade do link
                <select name="expiresInDays" defaultValue="7">
                  <option value="1">1 dia</option>
                  <option value="3">3 dias</option>
                  <option value="7">7 dias</option>
                  <option value="14">14 dias</option>
                  <option value="30">30 dias</option>
                </select>
              </label>
              <div className="form-wide dialog-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setSignatureFor(undefined)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={signatureBusy}>
                  {signatureBusy ? 'Criando link…' : 'Criar link de assinatura'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {signatureShare && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="surface signature-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signature-share-title"
          >
            <header className="dialog-heading">
              <div>
                <p>Link criado</p>
                <h2 id="signature-share-title">Compartilhar com {signatureShare.signerName}</h2>
              </div>
              <button
                className="table-action"
                type="button"
                onClick={() => setSignatureShare(undefined)}
                aria-label="Fechar"
              >
                Fechar
              </button>
            </header>
            <p>{signatureShare.title}</p>
            <label>
              Link de assinatura
              <input
                readOnly
                value={signatureShare.link}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className="dialog-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(signatureShare.link).then(
                    () => setSignatureFeedback('Link de assinatura copiado.'),
                    () =>
                      setSignatureFeedback(
                        'Não foi possível copiar automaticamente. Selecione o link para copiá-lo.',
                      ),
                  );
                }}
              >
                Copiar link
              </button>
              {signatureWhatsApp && (
                <a
                  className="primary"
                  href={`https://wa.me/${signatureWhatsApp}?text=${encodeURIComponent(`Olá, ${signatureShare.signerName}. Segue o documento ${signatureShare.title} para conferência e assinatura: ${signatureShare.link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir WhatsApp
                </a>
              )}
              {signatureShare.email && (
                <a
                  className="secondary"
                  href={`mailto:${encodeURIComponent(signatureShare.email)}?subject=${encodeURIComponent(`Assinatura de documento · ${signatureShare.title}`)}&body=${encodeURIComponent(`Olá, ${signatureShare.signerName}. Segue o documento ${signatureShare.title} para conferência e assinatura: ${signatureShare.link}`)}`}
                >
                  Preparar e-mail
                </a>
              )}
            </div>
            {signatureFeedback && (
              <small role="status" className="section-note">
                {signatureFeedback}
              </small>
            )}
            {signatureShare.phone && !signatureWhatsApp && (
              <small className="section-note">
                O telefone cadastrado não tem formato válido com DDD; copie o link e compartilhe
                pelo aplicativo conectado.
              </small>
            )}
            <small className="section-note">
              O link é uma credencial de acesso individual. A abertura do WhatsApp ou do e-mail não
              confirma o envio.
            </small>
          </section>
        </div>
      )}
    </section>
  );
}
