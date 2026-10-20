'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { Empty, Loading, Notice, Title } from '../shared/crm-ui';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';

type Client = {
  id: string;
  displayName: string;
};
type Matter = {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  client?: { id: string; displayName: string };
  currentStage?: Stage | null;
  pipeline?: Pipeline | null;
  nextAction?: string;
  nextActionAt?: string;
  description?: string;
  area?: string;
  courtNumberNormalized?: string;
  updatedAt?: string;
};
type Stage = { id: string; name: string; color?: string; position: number; isTerminal?: boolean };
type Pipeline = {
  id: string;
  name: string;
  kind: 'COMMERCIAL' | 'LEGAL' | 'COLLECTION';
  stages: Stage[];
};
const labels: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em andamento',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Concluida',
  LEAD: 'Lead',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CLOSED: 'Encerrado',
};
const asText = (value: string) => labels[value] ?? value;
export function MatterBoard({
  kind,
  title,
  permissions,
}: {
  kind?: Pipeline['kind'];
  title: string;
  permissions: readonly string[];
}) {
  const canViewPipelines = permissions.includes('pipelines:view');
  const canCreate = permissions.includes('matters:create');
  const canMove = permissions.includes('matters:update');
  const [showForm, setShowForm] = useState(false);
  const {
    data: pipelines,
    error: pipeError,
    reload: reloadPipes,
  } = useLoad<Pipeline[]>(canViewPipelines ? '/pipelines' : undefined);
  const clients = usePaginatedData<Client>(canCreate && showForm ? '/clients' : undefined, 100);
  const clientPage = clients.data;
  const clientsError = clients.error;
  const {
    data: matters,
    error,
    loading: loadingMatters,
    loadMore,
    reload,
    retry,
  } = usePaginatedData<Matter>('/matters');
  const [moving, setMoving] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const filtered = useMemo(
    () => matters?.items.filter((item) => !kind || item.pipeline?.kind === kind) ?? [],
    [matters, kind],
  );
  const move = async (matter: Matter, stageId: string) => {
    if (stageId === matter.currentStage?.id || moving) return;
    const previous = matter.currentStage?.id;
    setMoving(matter.id);
    try {
      await api(`/matters/${matter.id}/stage-movements`, {
        method: 'POST',
        body: JSON.stringify({ toStageId: stageId }),
      });
      await reload();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : 'Movimentacao nao concluida. O cartao foi restaurado.',
      );
    } finally {
      setMoving(undefined);
      if (previous) void previous;
    }
  };
  const selectedPipelines = (pipelines ?? []).filter((p) => !kind || p.kind === kind);
  const configuredStageIds = new Set(
    selectedPipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)),
  );
  const mattersWithoutConfiguredStage = filtered.filter(
    (matter) => !matter.currentStage || !configuredStageIds.has(matter.currentStage.id),
  );
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const pipelineId = String(form.get('pipelineId') ?? '');
    const pipeline = pipelines?.find((item) => item.id === pipelineId);
    setMoving('create');
    setFeedback(undefined);
    try {
      await api('/matters', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.get('clientId'),
          reference: form.get('reference'),
          title: form.get('title'),
          description: form.get('description') || undefined,
          courtNumber: form.get('courtNumber') || undefined,
          area: form.get('area') || undefined,
          status: form.get('status'),
          priority: form.get('priority'),
          nextAction: form.get('nextAction') || undefined,
          nextActionAt: form.get('nextActionAt') || undefined,
          pipelineId: pipelineId || undefined,
          currentStageId: pipeline
            ? [...pipeline.stages].sort((a, b) => a.position - b.position)[0]?.id
            : undefined,
          labels: [],
          confidential: form.get('confidential') === 'on',
        }),
      });
      setFeedback('Processo cadastrado.');
      setShowForm(false);
      target.reset();
      await reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'processo não cadastrado'}`,
      );
    } finally {
      setMoving(undefined);
    }
  };
  const update = async (matter: Matter, changes: Record<string, unknown>) => {
    setMoving(matter.id);
    setFeedback(undefined);
    try {
      await api(`/matters/${matter.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
      setFeedback('Processo atualizado.');
      await reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'processo não atualizado'}`,
      );
    } finally {
      setMoving(undefined);
    }
  };
  const assignToPipeline = async (matter: Matter, pipelineId: string) => {
    const pipeline = selectedPipelines.find((item) => item.id === pipelineId);
    const firstStage = pipeline
      ? [...pipeline.stages].sort((a, b) => a.position - b.position)[0]
      : undefined;
    if (!pipeline || !firstStage || moving) return;
    setMoving(matter.id);
    setFeedback(undefined);
    try {
      await api(`/matters/${matter.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pipelineId: pipeline.id }),
      });
      await api(`/matters/${matter.id}/stage-movements`, {
        method: 'POST',
        body: JSON.stringify({ toStageId: firstStage.id }),
      });
      setFeedback(`Processo movido para ${pipeline.name}.`);
      await reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'pipeline não atribuído'}`,
      );
      await reload();
    } finally {
      setMoving(undefined);
    }
  };
  return (
    <section>
      <Title
        title={title}
        description="Cadastre processos, acompanhe etapas, prioridades e próximas ações."
        action={
          canCreate ? (
            <button className="primary" onClick={() => setShowForm((value) => !value)}>
              {showForm ? 'Fechar' : 'Novo processo'}
            </button>
          ) : undefined
        }
      />
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
              {clientPage?.items.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.displayName}
                </option>
              ))}
            </select>
          </label>
          {clientPage && (
            <div className="form-wide">
              <LoadMore
                shown={clientPage.items.length}
                total={clientPage.total}
                loading={clients.loading}
                error={clientsError}
                onLoad={clients.loadMore}
                onRetry={clients.retry}
              />
            </div>
          )}
          <label>
            Referência
            <input required name="reference" maxLength={80} />
          </label>
          <label>
            Título
            <input required name="title" minLength={2} />
          </label>
          <label>
            Número judicial
            <input name="courtNumber" maxLength={80} />
          </label>
          <label>
            Área
            <input name="area" maxLength={120} />
          </label>
          <label>
            Pipeline
            <select name="pipelineId" defaultValue="">
              <option value="">Sem pipeline</option>
              {selectedPipelines.map((pipeline) => (
                <option value={pipeline.id} key={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="LEAD">
              <option value="LEAD">Lead</option>
              <option value="ACTIVE">Ativo</option>
              <option value="SUSPENDED">Suspenso</option>
              <option value="CLOSED">Encerrado</option>
            </select>
          </label>
          <label>
            Prioridade
            <select name="priority" defaultValue="MEDIUM">
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
          <label>
            Próxima ação
            <input name="nextAction" maxLength={500} />
          </label>
          <label>
            Data da próxima ação
            <input type="datetime-local" name="nextActionAt" />
          </label>
          <label className="form-wide">
            Descrição
            <textarea name="description" rows={3} maxLength={10_000} />
          </label>
          <label className="check">
            <input type="checkbox" name="confidential" /> Confidencial
          </label>
          <button className="primary form-wide" disabled={moving === 'create'}>
            {moving === 'create' ? 'Cadastrando…' : 'Cadastrar processo'}
          </button>
        </form>
      )}
      <Notice
        error={pipeError ?? clientsError ?? (!matters ? error : undefined)}
        onRetry={() => {
          void reload();
          void reloadPipes();
        }}
      />
      {(!matters || (canViewPipelines && !pipelines)) && !(pipeError || error) ? (
        <Loading />
      ) : !canViewPipelines ? (
        filtered.length ? (
          <div className="surface table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Processo</th>
                  <th>Cliente</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((matter) => (
                  <tr key={matter.id}>
                    <td>{matter.reference}</td>
                    <td>{matter.title}</td>
                    <td>{matter.client?.displayName ?? '—'}</td>
                    <td>{asText(matter.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhum processo no seu escopo.</Empty>
        )
      ) : selectedPipelines.length ? (
        <>
          {selectedPipelines.map((pipeline) => (
            <section className="board" key={pipeline.id}>
              <h2>{pipeline.name}</h2>
              <div className="kanban">
                {[...pipeline.stages]
                  .sort((a, b) => a.position - b.position)
                  .map((stage) => (
                    <div className="column" key={stage.id}>
                      <header>
                        <i style={{ backgroundColor: stage.color ?? '#5f766d' }} />
                        {stage.name}
                        <span>
                          {filtered.filter((m) => m.currentStage?.id === stage.id).length}
                        </span>
                      </header>
                      {filtered
                        .filter((m) => m.currentStage?.id === stage.id)
                        .map((matter) => (
                          <article className="kanban-card" key={matter.id}>
                            <b>{matter.reference}</b>
                            <strong>{matter.title}</strong>
                            <small>{matter.client?.displayName ?? 'Cliente nao informado'}</small>
                            <div>
                              <span className={`badge priority-${matter.priority.toLowerCase()}`}>
                                {asText(matter.priority)}
                              </span>
                              <span>{matter.nextAction ?? 'Sem proxima acao'}</span>
                            </div>
                            {canMove && (
                              <div className="matter-controls">
                                <label>
                                  Status
                                  <select
                                    aria-label={`Status de ${matter.title}`}
                                    value={matter.status}
                                    disabled={moving === matter.id}
                                    onChange={(event) =>
                                      void update(matter, { status: event.target.value })
                                    }
                                  >
                                    <option value="LEAD">Lead</option>
                                    <option value="ACTIVE">Ativo</option>
                                    <option value="SUSPENDED">Suspenso</option>
                                    <option value="CLOSED">Encerrado</option>
                                    <option value="ARCHIVED">Arquivado</option>
                                  </select>
                                </label>
                                <label>
                                  Prioridade
                                  <select
                                    aria-label={`Prioridade de ${matter.title}`}
                                    value={matter.priority}
                                    disabled={moving === matter.id}
                                    onChange={(event) =>
                                      void update(matter, { priority: event.target.value })
                                    }
                                  >
                                    <option value="LOW">Baixa</option>
                                    <option value="MEDIUM">Média</option>
                                    <option value="HIGH">Alta</option>
                                    <option value="URGENT">Urgente</option>
                                  </select>
                                </label>
                              </div>
                            )}
                            {canMove && (
                              <>
                                <label className="sr-only" htmlFor={`move-${matter.id}`}>
                                  Mover {matter.title}
                                </label>
                                <select
                                  id={`move-${matter.id}`}
                                  disabled={moving === matter.id}
                                  value={matter.currentStage?.id ?? ''}
                                  onChange={(e) => void move(matter, e.target.value)}
                                >
                                  <option value="" disabled>
                                    Sem etapa
                                  </option>
                                  {pipeline.stages.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </article>
                        ))}
                    </div>
                  ))}
              </div>
            </section>
          ))}
          {mattersWithoutConfiguredStage.length > 0 && (
            <MatterFallbackTable
              title="Processos sem etapa configurada"
              matters={mattersWithoutConfiguredStage}
              canUpdate={canMove}
              moving={moving}
              update={update}
              pipelines={selectedPipelines}
              assignToPipeline={assignToPipeline}
            />
          )}
        </>
      ) : filtered.length ? (
        <MatterFallbackTable
          title="Processos cadastrados"
          matters={filtered}
          canUpdate={canMove}
          moving={moving}
          update={update}
          pipelines={selectedPipelines}
          assignToPipeline={assignToPipeline}
        />
      ) : (
        <Empty>Crie e configure um pipeline antes de movimentar processos.</Empty>
      )}
      {matters && (
        <LoadMore
          shown={matters.items.length}
          total={matters.total}
          loading={loadingMatters}
          error={error}
          onLoad={loadMore}
          onRetry={retry}
        />
      )}
    </section>
  );
}

function MatterFallbackTable({
  title,
  matters,
  canUpdate,
  moving,
  update,
  pipelines,
  assignToPipeline,
}: {
  title: string;
  matters: Matter[];
  canUpdate: boolean;
  moving?: string;
  update: (matter: Matter, changes: Record<string, unknown>) => Promise<void>;
  pipelines: Pipeline[];
  assignToPipeline: (matter: Matter, pipelineId: string) => Promise<void>;
}) {
  return (
    <section className="surface table-wrap">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Referência</th>
            <th>Processo</th>
            <th>Cliente</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Etapa</th>
          </tr>
        </thead>
        <tbody>
          {matters.map((matter) => (
            <tr key={matter.id}>
              <td>{matter.reference}</td>
              <td>{matter.title}</td>
              <td>{matter.client?.displayName ?? '—'}</td>
              <td>
                {canUpdate ? (
                  <select
                    aria-label={`Status de ${matter.title}`}
                    value={matter.status}
                    disabled={moving === matter.id}
                    onChange={(event) => void update(matter, { status: event.target.value })}
                  >
                    <option value="LEAD">Lead</option>
                    <option value="ACTIVE">Ativo</option>
                    <option value="SUSPENDED">Suspenso</option>
                    <option value="CLOSED">Encerrado</option>
                    <option value="ARCHIVED">Arquivado</option>
                  </select>
                ) : (
                  asText(matter.status)
                )}
              </td>
              <td>
                {canUpdate ? (
                  <select
                    aria-label={`Prioridade de ${matter.title}`}
                    value={matter.priority}
                    disabled={moving === matter.id}
                    onChange={(event) => void update(matter, { priority: event.target.value })}
                  >
                    <option value="LOW">Baixa</option>
                    <option value="MEDIUM">Média</option>
                    <option value="HIGH">Alta</option>
                    <option value="URGENT">Urgente</option>
                  </select>
                ) : (
                  asText(matter.priority)
                )}
              </td>
              <td>
                {canUpdate && pipelines.length > 0 ? (
                  <select
                    aria-label={`Pipeline de ${matter.title}`}
                    defaultValue=""
                    disabled={moving === matter.id}
                    onChange={(event) => void assignToPipeline(matter, event.target.value)}
                  >
                    <option value="" disabled>
                      Atribuir pipeline
                    </option>
                    {pipelines.map((pipeline) => (
                      <option value={pipeline.id} key={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  'Sem etapa configurada'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function useLoad<T>(path?: string, debounce = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      setData(undefined);
      setError(undefined);
      return undefined;
    }
    const controller = new AbortController();
    setData(undefined);
    setError(undefined);
    const timer = setTimeout(() => {
      api<T>(path, {}, controller.signal)
        .then(setData)
        .catch((e: unknown) => {
          if (!(e instanceof DOMException) && e instanceof ApiError) setError(e);
        });
    }, debounce);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, debounce, key]);
  return { data, error, reload };
}
