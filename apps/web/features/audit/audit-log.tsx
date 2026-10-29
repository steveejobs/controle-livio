'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';

type ActivityEvent = {
  id: string;
  kind: 'CHANGE' | 'ACCESS' | 'NAVIGATION';
  action: string;
  resource: string;
  resourceId?: string | null;
  summary?: string;
  targetLabel?: string;
  changedFields: string[];
  occurredAt: string;
  actorUserId?: string;
  actorName: string;
  actorEmail?: string;
};
type Actor = { id: string; fullName: string; email: string };
type ActivityFilters = {
  category: 'all' | 'changes' | 'access' | 'navigation';
  actorUserId: string;
  search: string;
  dateFrom: string;
  dateTo: string;
};
type ActorResponse = { items: Actor[]; total: number };

const actionLabels: Record<string, string> = {
  CREATE: 'Criou',
  UPDATE: 'Atualizou',
  DELETE: 'Removeu',
  VIEW: 'Consultou',
  EXPORT: 'Exportou',
  APPROVE: 'Aprovou',
  LOGIN: 'Entrou no sistema',
  LOGOUT: 'Saiu do sistema',
  LOGIN_FAILED: 'Tentativa de acesso recusada',
  PASSWORD_RESET_REQUESTED: 'Solicitou redefinição de senha',
  PASSWORD_RESET_COMPLETED: 'Redefiniu a senha',
  SESSION_REVOKED: 'Encerrou uma sessão',
  REVERSE: 'Estornou',
  CANCEL: 'Cancelou',
};

const resourceLabels: Record<string, string> = {
  'organization.document_settings': 'dados do escritório',
  'organization.document_template': 'modelo de documento',
  calendar_event: 'evento da agenda',
  client: 'cadastro de cliente',
  client_contact: 'contato do cliente',
  client_message: 'comunicação com cliente',
  contract: 'contrato de honorários',
  document: 'documento',
  expense: 'despesa',
  financial_adjustment: 'ajuste financeiro',
  internal_note: 'nota interna',
  matter: 'processo ou negociação',
  matter_party: 'parte do processo',
  payment: 'pagamento',
  payment_change_request: 'correção de pagamento',
  pipeline: 'pipeline',
  pipeline_stage: 'etapa do pipeline',
  receivable: 'cobrança',
  renegotiation: 'renegociação',
  role: 'papel de acesso',
  service_catalog_item: 'serviço salvo',
  task: 'tarefa',
  user: 'acesso de usuário',
};

const areaLabels: Record<string, string> = {
  'organization.document_settings': 'Documentos',
  'organization.document_template': 'Modelos de documentos',
  calendar_event: 'Agenda',
  client: 'Clientes',
  client_contact: 'Clientes',
  client_message: 'Clientes',
  contract: 'Contratos',
  document: 'Documentos',
  expense: 'Financeiro',
  financial_adjustment: 'Financeiro',
  internal_note: 'Clientes',
  matter: 'Processos e CRM',
  matter_party: 'Processos',
  payment: 'Financeiro',
  payment_change_request: 'Financeiro',
  pipeline: 'Pipelines',
  pipeline_stage: 'Pipelines',
  receivable: 'Cobranças',
  renegotiation: 'Cobranças',
  role: 'Acessos',
  service_catalog_item: 'Contratos',
  task: 'Tarefas',
  user: 'Acessos',
};

const emptyFilters: ActivityFilters = {
  category: 'all',
  actorUserId: '',
  search: '',
  dateFrom: '',
  dateTo: '',
};

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function actionDescription(item: ActivityEvent) {
  if (item.summary) return item.summary;
  const action = actionLabels[item.action] ?? item.action;
  const resource = resourceLabels[item.resource] ?? item.resource.replace(/[._]/g, ' ');
  return `${action} ${resource}${item.targetLabel ? ` · ${item.targetLabel}` : ''}`;
}

export function AuditLog() {
  const [filters, setFilters] = useState<ActivityFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<ActivityFilters>(emptyFilters);
  const [actors, setActors] = useState<Actor[]>([]);
  const [actorsError, setActorsError] = useState<string>();
  const [filtersError, setFiltersError] = useState<string>();
  useEffect(() => {
    let active = true;
    void api<ActorResponse>('/audit-logs/actors')
      .then((response) => {
        if (active) setActors(response.items);
      })
      .catch((error: unknown) => {
        if (active)
          setActorsError(
            error instanceof ApiError ? error.message : 'Não foi possível carregar os usuários.',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('category', appliedFilters.category);
    if (appliedFilters.actorUserId) params.set('actorUserId', appliedFilters.actorUserId);
    if (appliedFilters.search.trim()) params.set('search', appliedFilters.search.trim());
    if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
    return `/audit-logs?${params.toString()}`;
  }, [appliedFilters]);
  const events = usePaginatedData<ActivityEvent>(path);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      setFiltersError('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
    setFiltersError(undefined);
    setAppliedFilters(filters);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setFiltersError(undefined);
    setAppliedFilters(emptyFilters);
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Atividades do sistema</h1>
          <span>Veja quem acessou cada área e as principais alterações feitas na organização.</span>
        </div>
      </header>

      <form className="surface activity-filters" onSubmit={applyFilters}>
        <label>
          Tipo de atividade
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters({
                ...filters,
                category: event.target.value as ActivityFilters['category'],
              })
            }
          >
            <option value="all">Todas</option>
            <option value="changes">Alterações</option>
            <option value="access">Acessos ao sistema</option>
            <option value="navigation">Áreas abertas</option>
          </select>
        </label>
        <label>
          Usuário
          <select
            value={filters.actorUserId}
            onChange={(event) => setFilters({ ...filters, actorUserId: event.target.value })}
          >
            <option value="">Todos os usuários</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.fullName} · {actor.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar atividade
          <input
            value={filters.search}
            maxLength={120}
            placeholder="Nome, e-mail ou tipo de ação"
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <label>
          De
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
          />
        </label>
        <div className="activity-filter-actions">
          <button type="submit" className="primary">
            Filtrar
          </button>
          <button type="button" className="secondary" onClick={clearFilters}>
            Limpar filtros
          </button>
        </div>
      </form>

      {actorsError && (
        <div role="status" className="notice">
          {actorsError}
        </div>
      )}
      {filtersError && (
        <div role="alert" className="notice notice-error">
          {filtersError}
        </div>
      )}
      {events.error && !events.data && (
        <div role="alert" className="notice notice-error">
          {events.error.message} <button onClick={events.retry}>Tentar novamente</button>
        </div>
      )}
      {!events.data && !events.error ? (
        <div className="loading" role="status" aria-label="Carregando atividades">
          <i />
          <i />
          <i />
        </div>
      ) : events.data?.items.length ? (
        <>
          <p className="section-note" aria-live="polite">
            {events.data.total.toLocaleString('pt-BR')} atividades encontradas.
          </p>
          <div className="activity-list" aria-label="Atividades registradas">
            {events.data.items.map((item) => (
              <article className="surface activity-entry" key={item.id}>
                <header>
                  <h2>{actionDescription(item)}</h2>
                  <time dateTime={item.occurredAt}>{formatActivityTime(item.occurredAt)}</time>
                </header>
                <p>
                  {item.actorName}
                  {item.actorEmail ? ` · ${item.actorEmail}` : ''}
                  {areaLabels[item.resource] ? ` · ${areaLabels[item.resource]}` : ''}
                </p>
                {item.kind === 'CHANGE' && item.changedFields.length > 0 && (
                  <details>
                    <summary>Campos alterados ({item.changedFields.length})</summary>
                    <p>{item.changedFields.join(' · ')}</p>
                  </details>
                )}
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="empty">
          <strong>Nenhuma atividade neste período</strong>
          <span>Altere os filtros ou aguarde novas ações da equipe.</span>
        </div>
      )}
      {events.data && (
        <LoadMore
          shown={events.data.items.length}
          total={events.data.total}
          loading={events.loading}
          error={events.error}
          onLoad={events.loadMore}
          onRetry={events.retry}
        />
      )}
    </section>
  );
}
