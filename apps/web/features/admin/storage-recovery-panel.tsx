'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApiData } from '../shared/use-api-data';

type Incident = {
  id: string;
  kind: string;
  bucket: string;
  objectKey: string;
  state: string;
  notificationUndelivered: boolean;
};
type Overview = {
  incidents: Incident[];
  pending: number;
  overdue: number;
  undelivered: number;
  pageLimit: number;
  workerEnabled: boolean;
  deletionEnabled: boolean;
  nextCursor?: string | null;
};

export function StorageRecoveryPanel({ canManage }: { canManage: boolean }) {
  const [pages, setPages] = useState<Array<string | undefined>>([undefined]);
  const cursor = pages.at(-1);
  const result = useApiData<Overview>(
    '/storage-recovery' + (cursor ? '?afterId=' + encodeURIComponent(cursor) : ''),
  );
  const [selected, setSelected] = useState<Incident>();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage || busy) return;
    const input = new FormData(event.currentTarget);
    setBusy(true);
    setFeedback(undefined);
    try {
      const next = await api<{ state: string }>(
        `/storage-recovery/incidents/${selected.id}/decisions`,
        {
          method: 'POST',
          body: JSON.stringify({ action: input.get('action'), reason: input.get('reason') }),
        },
      );
      setFeedback(
        next.state === 'OPEN'
          ? 'Conservação registrada. O incidente continua aberto e exige restauração ou análise específica.'
          : 'Decisão registrada e auditada.',
      );
      setSelected(undefined);
      result.reload();
    } catch (error) {
      setFeedback(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível registrar a decisão. Recarregue e confira o incidente.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section-block" aria-label="Recuperação de arquivos">
      <h2>Recuperação de arquivos</h2>
      <p>
        Arquivos com vínculo ou retenção são preservados. Objetos desconhecidos exigem análise; esta
        tela não oferece exclusão direta.
      </p>
      {result.error ? (
        <p role="alert">{result.error.message}</p>
      ) : !result.data ? (
        <p role="status">Carregando recuperação de arquivos</p>
      ) : (
        <>
          <p>
            Pendentes: {result.data.pending} · Vencidos: {result.data.overdue} · Alertas sem
            destinatário: {result.data.undelivered}
          </p>
          <p>
            Processamento automático: {result.data.workerEnabled ? 'habilitado' : 'desabilitado'}.
            Remoção por rotina: {result.data.deletionEnabled ? 'habilitada' : 'desabilitada'}.
          </p>
          <p>
            Até {result.data.pageLimit} incidentes abertos por página, começando pelos mais antigos.
          </p>
          {!result.data.incidents.length ? (
            <p>Nenhum incidente aberto nesta consulta.</p>
          ) : (
            <ul>
              {result.data.incidents.map((incident) => (
                <li key={incident.id}>
                  <p>
                    {incident.kind} · {incident.id}
                  </p>
                  <p style={{ overflowWrap: 'anywhere' }}>
                    {incident.bucket}/{incident.objectKey}
                  </p>
                  {incident.notificationUndelivered && <p>Alerta sem destinatário ativo.</p>}
                  {canManage && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Revisar incidente ${incident.id}`}
                      disabled={busy}
                      onClick={() => setSelected(incident)}
                    >
                      Revisar incidente
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {selected && (
        <form
          className="surface form-grid"
          onSubmit={(event) => void submit(event)}
          aria-label="Decisão sobre incidente"
        >
          <h3>Revisar {selected.id}</h3>
          <label>
            Decisão
            <select name="action" required disabled={busy}>
              <option value="RETAIN">Conservar arquivo</option>
              <option value="RETRY">Reavaliar compensação</option>
            </select>
          </label>
          <p>
            Uma nova avaliação exige rechecagem de vínculo, retenção e hash. Ela não ignora
            controles nem garante remoção.
          </p>
          <label>
            Motivo
            <textarea name="reason" minLength={12} maxLength={1000} required disabled={busy} />
          </label>
          <p>Não inclua documentos, credenciais ou links no motivo.</p>
          <button className="primary" type="submit" disabled={busy}>
            Registrar decisão
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => setSelected(undefined)}
          >
            Cancelar revisão
          </button>
        </form>
      )}
      {feedback && <p role="status">{feedback}</p>}
      <button
        type="button"
        className="secondary"
        disabled={busy || pages.length === 1}
        onClick={() => {
          setSelected(undefined);
          setPages((current) => current.slice(0, -1));
        }}
      >
        Página anterior de incidentes
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy || !result.data?.nextCursor}
        onClick={() => {
          const next = result.data?.nextCursor;
          if (next) {
            setSelected(undefined);
            setPages((current) => [...current, next]);
          }
        }}
      >
        Próxima página de incidentes
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={result.reload}>
        Atualizar incidentes
      </button>
    </section>
  );
}
