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
  customFields?: {
    collectionObjective?: { kind?: string; description?: string };
  };
  area?: string;
  courtNumberNormalized?: string;
  updatedAt?: string;
};
type MatterTimeline = {
  matter: {
    reference: string;
    title: string;
    courtNumberNormalized?: string | null;
    client: { displayName: string };
  };
  entries: Array<{
    id: string;
    type: string;
    title: string;
    description?: string;
    occurredAt: string;
  }>;
};
type Stage = { id: string; name: string; color?: string; position: number; isTerminal?: boolean };
type Pipeline = {
  id: string;
  name: string;
  kind: 'COMMERCIAL' | 'LEGAL' | 'COLLECTION';
  stages: Stage[];
};
type PipelineKind = Pipeline['kind'];
type PipelineKindFilter = PipelineKind | readonly PipelineKind[];
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
const matchesPipelineKind = (
  kind: PipelineKindFilter | undefined,
  candidate?: PipelineKind | null,
) => {
  if (!kind) return true;
  if (!candidate) return false;
  return typeof kind === 'string' ? kind === candidate : kind.includes(candidate);
};

export function MatterBoard({
  kind,
  title,
  permissions,
}: {
  kind?: PipelineKindFilter;
  title: string;
  permissions: readonly string[];
}) {
  const canViewPipelines = permissions.includes('pipelines:view');
  const canCreate = permissions.includes('matters:create');
  const canMove = permissions.includes('matters:update');
  const description = Array.isArray(kind)
    ? 'Acompanhe oportunidades e processos jurídicos em seus respectivos fluxos.'
    : kind === 'COMMERCIAL'
      ? 'Acompanhe contatos, propostas e oportunidades comerciais.'
      : kind === 'COLLECTION'
        ? 'Acompanhe negociações de cobrança e as próximas ações de recuperação.'
        : 'Cadastre processos jurídicos e acompanhe etapas e próximas ações.';
  const [showForm, setShowForm] = useState(false);
  const [createPipelineId, setCreatePipelineId] = useState('');
  const [objectiveWithoutValue, setObjectiveWithoutValue] = useState(false);
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
  const [timelineMatterId, setTimelineMatterId] = useState<string>();
  const filtered = useMemo(
    () => matters?.items.filter((item) => matchesPipelineKind(kind, item.pipeline?.kind)) ?? [],
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
  const selectedPipelines = (pipelines ?? []).filter((pipeline) =>
    matchesPipelineKind(kind, pipeline.kind),
  );
  const isUnifiedCrm = Array.isArray(kind);
  const createPipeline = selectedPipelines.find((pipeline) => pipeline.id === createPipelineId);
  const createKind = createPipeline?.kind ?? (typeof kind === 'string' ? kind : undefined);
  const isCommercialCreate = createKind === 'COMMERCIAL';
  const isCollectionCreate = createKind === 'COLLECTION';
  const showLegalFields =
    createKind === 'LEGAL' || (!isUnifiedCrm && createKind === undefined && kind === undefined);
  const recordNameLabel =
    isUnifiedCrm && !createPipeline
      ? 'Nome do processo ou da oportunidade'
      : isCommercialCreate
        ? 'Nome da oportunidade'
        : isCollectionCreate
          ? 'Identificação da cobrança'
          : 'Nome do processo';
  const referenceLabel =
    isUnifiedCrm && !createPipeline
      ? 'Identificador interno'
      : isCommercialCreate
        ? 'Código da oportunidade'
        : isCollectionCreate
          ? 'Código da cobrança'
          : 'Referência interna do processo';
  const descriptionLabel = isCommercialCreate
    ? 'Resumo da oportunidade (opcional)'
    : isCollectionCreate
      ? 'Detalhes da cobrança (opcional)'
      : isUnifiedCrm && !createPipeline
        ? 'Resumo do processo ou da oportunidade (opcional)'
        : 'Resumo do processo (opcional)';
  const createButtonLabel =
    isUnifiedCrm && !createPipeline
      ? 'Cadastrar processo ou oportunidade'
      : isCommercialCreate
        ? 'Cadastrar oportunidade'
        : isCollectionCreate
          ? 'Cadastrar cobrança'
          : 'Cadastrar processo';
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
          collectionObjective:
            form.get('objectiveWithoutValue') === 'on'
              ? { description: form.get('objectiveDescription') }
              : undefined,
          courtNumber: form.get('courtNumber') || undefined,
          area: form.get('area') || undefined,
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
      setFeedback(
        pipeline?.kind === 'COMMERCIAL'
          ? 'Oportunidade cadastrada.'
          : pipeline?.kind === 'COLLECTION'
            ? 'Cobrança cadastrada.'
            : 'Processo cadastrado.',
      );
      setShowForm(false);
      setCreatePipelineId('');
      setObjectiveWithoutValue(false);
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
        description={description}
        action={
          canCreate ? (
            <button
              className="primary"
              onClick={() => {
                const opening = !showForm;
                setCreatePipelineId(
                  opening && kind === 'COLLECTION' ? (selectedPipelines[0]?.id ?? '') : '',
                );
                setObjectiveWithoutValue(false);
                setShowForm(opening);
              }}
            >
              {showForm
                ? 'Fechar'
                : isUnifiedCrm
                  ? 'Nova oportunidade ou processo'
                  : kind === 'COLLECTION'
                    ? 'Nova cobrança'
                    : 'Novo processo'}
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
      {timelineMatterId && (
        <MatterTimelinePanel id={timelineMatterId} onClose={() => setTimelineMatterId(undefined)} />
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
            Fluxo de atendimento
            <select
              name="pipelineId"
              value={createPipelineId}
              required={isUnifiedCrm || (isCollectionCreate && objectiveWithoutValue)}
              onChange={(event) => {
                setCreatePipelineId(event.target.value);
                setObjectiveWithoutValue(false);
              }}
            >
              <option value="" disabled={isUnifiedCrm}>
                {isUnifiedCrm ? 'Selecione o tipo de atendimento' : 'Sem fluxo específico'}
              </option>
              {selectedPipelines.map((pipeline) => (
                <option value={pipeline.id} key={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          {isUnifiedCrm && !selectedPipelines.length && (
            <p className="section-note form-wide">
              Crie um fluxo comercial ou jurídico antes de cadastrar neste CRM.
            </p>
          )}
          {(!isUnifiedCrm || createPipeline) && (
            <>
              <label>
                {referenceLabel}
                <input required name="reference" maxLength={80} />
              </label>
              <label>
                {isCollectionCreate && objectiveWithoutValue
                  ? 'Objetivo da negociação'
                  : recordNameLabel}
                <input required name="title" minLength={2} />
              </label>
              {isCollectionCreate && (
                <>
                  <label className="checkbox-label form-wide">
                    <input
                      type="checkbox"
                      name="objectiveWithoutValue"
                      checked={objectiveWithoutValue}
                      onChange={(event) => setObjectiveWithoutValue(event.target.checked)}
                    />
                    Registrar objetivo sem valor financeiro
                  </label>
                  {objectiveWithoutValue && (
                    <label className="form-wide">
                      Descreva o objetivo da negociação
                      <textarea name="objectiveDescription" required rows={3} maxLength={2_000} />
                    </label>
                  )}
                </>
              )}
              {showLegalFields && (
                <>
                  <label>
                    Número judicial ou CNJ (opcional)
                    <input name="courtNumber" maxLength={80} />
                  </label>
                  <label>
                    Área jurídica (opcional)
                    <input name="area" maxLength={120} />
                  </label>
                </>
              )}
              <details className="optional-fields form-wide matter-extra-details">
                <summary>
                  {isCommercialCreate
                    ? 'Acompanhamento da oportunidade (opcional)'
                    : isCollectionCreate
                      ? 'Acompanhamento da cobrança (opcional)'
                      : 'Dados complementares do processo (opcional)'}
                </summary>
                <div className="form-grid">
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
                    {isCommercialCreate ? 'Próximo contato (opcional)' : 'Próxima ação (opcional)'}
                    <input name="nextAction" maxLength={500} />
                  </label>
                  <label>
                    {isCommercialCreate
                      ? 'Data do próximo contato (opcional)'
                      : 'Data da próxima ação (opcional)'}
                    <input type="datetime-local" name="nextActionAt" />
                  </label>
                  {!(isCollectionCreate && objectiveWithoutValue) && (
                    <label className="form-wide">
                      {descriptionLabel}
                      <textarea name="description" rows={3} maxLength={10_000} />
                    </label>
                  )}
                  {showLegalFields && (
                    <label className="check">
                      <input type="checkbox" name="confidential" /> Processo confidencial
                    </label>
                  )}
                </div>
              </details>
            </>
          )}
          <button
            className="primary form-wide"
            disabled={moving === 'create' || (isUnifiedCrm && !selectedPipelines.length)}
          >
            {moving === 'create' ? 'Cadastrando…' : createButtonLabel}
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
              <div
                className="kanban"
                role="region"
                aria-label={`Etapas do fluxo ${pipeline.name}`}
                tabIndex={0}
              >
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
                            <button
                              className="matter-timeline-button"
                              onClick={() => setTimelineMatterId(matter.id)}
                            >
                              Ver acompanhamento
                            </button>
                            {matter.customFields?.collectionObjective?.description && (
                              <small>
                                <span className="badge">Objetivo sem valor financeiro</span>{' '}
                                {matter.customFields.collectionObjective.description}
                              </small>
                            )}
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
              onOpenTimeline={setTimelineMatterId}
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
          onOpenTimeline={setTimelineMatterId}
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
  onOpenTimeline,
}: {
  title: string;
  matters: Matter[];
  canUpdate: boolean;
  moving?: string;
  update: (matter: Matter, changes: Record<string, unknown>) => Promise<void>;
  pipelines: Pipeline[];
  assignToPipeline: (matter: Matter, pipelineId: string) => Promise<void>;
  onOpenTimeline: (matterId: string) => void;
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
            <th>Acompanhamento</th>
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
              <td>
                <button className="table-action" onClick={() => onOpenTimeline(matter.id)}>
                  Linha do tempo
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MatterTimelinePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useLoad<MatterTimeline>(`/matters/${id}/timeline`);
  return (
    <section className="surface matter-timeline" aria-labelledby="matter-timeline-title">
      <header>
        <div>
          <p>Acompanhamento do processo</p>
          <h2 id="matter-timeline-title">{data?.matter.title ?? 'Carregando linha do tempo…'}</h2>
          {data?.matter && (
            <small>
              {data.matter.reference} · {data.matter.client.displayName}
              {data.matter.courtNumberNormalized ? ` · ${data.matter.courtNumberNormalized}` : ''}
            </small>
          )}
        </div>
        <button className="secondary" onClick={onClose}>
          Fechar acompanhamento
        </button>
      </header>
      {error && (
        <div role="alert" className="notice notice-error">
          {error.message} <button onClick={reload}>Tentar novamente</button>
        </div>
      )}
      {!data && !error ? (
        <Loading />
      ) : data?.entries.length ? (
        <ol className="timeline-list">
          {data.entries.map((entry) => (
            <li
              key={`${entry.type}-${entry.id}`}
              className={`timeline-entry timeline-${entry.type.toLowerCase()}`}
            >
              <span aria-hidden="true" className="timeline-dot" />
              <div>
                <div className="timeline-entry-heading">
                  <strong>{entry.title}</strong>
                  <time dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
                {entry.description && <p>{entry.description}</p>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="section-note">
          Ainda não há movimentações registradas. As próximas etapas, prazos, audiências e
          documentos aparecerão aqui.
        </p>
      )}
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
