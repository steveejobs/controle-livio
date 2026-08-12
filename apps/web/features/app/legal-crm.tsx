'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ProductBrand } from '../../components/product-brand';
import { ApiError, api, resetApiSession } from '../../lib/api';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';

const TeamManagement = dynamic(() =>
  import('../admin/team-management').then((module) => module.TeamManagement),
);
const ClientManagement = dynamic(() =>
  import('../clients/client-management').then((module) => module.ClientManagement),
);
const OperationalDashboard = dynamic(() =>
  import('../dashboard/operational-dashboard').then((module) => module.OperationalDashboard),
);
const FinanceOperations = dynamic(() =>
  import('../finance/finance-operations').then((module) => module.FinanceOperations),
);
const NotificationsCenter = dynamic(() =>
  import('../notifications/notifications-center').then((module) => module.NotificationsCenter),
);
const ReportsCenter = dynamic(() =>
  import('../reports/reports-center').then((module) => module.ReportsCenter),
);

const TasksModule = dynamic(() => import('../work/tasks').then((module) => module.Tasks));
const CalendarModule = dynamic(() => import('../work/calendar').then((module) => module.Calendar));
const DocumentsModule = dynamic(() =>
  import('../documents/documents').then((module) => module.Documents),
);
const ContractsModule = dynamic(() =>
  import('../finance/contracts').then((module) => module.Contracts),
);
const PipelinesModule = dynamic(() =>
  import('../matters/pipelines').then((module) => module.Pipelines),
);
const AuditModule = dynamic(() => import('../audit/audit-log').then((module) => module.AuditLog));
const ClientPortalModule = dynamic(() =>
  import('../portal/client-portal').then((module) => module.ClientPortal),
);

type Page<T> = { items: T[]; total: number };
type Client = {
  id: string;
  displayName: string;
  type: string;
  email?: string;
  phone?: string;
  taxIdNormalized?: string;
  contacts?: Contact[];
  updatedAt?: string;
};
type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary: boolean;
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
type Session = {
  user: { id: string; name?: string; email: string; clientId?: string; permissions?: string[] };
  organization: { name?: string; slug?: string };
};
type NavItem = readonly [id: string, name: string, icon: string];
type NavGroup = { label: string; items: readonly NavItem[] };

const navPermissions: Readonly<Record<string, string>> = {
  dashboard: 'reports:view',
  portal: 'messages:view',
  clients: 'clients:view',
  matters: 'matters:view',
  commercial: 'matters:view',
  legal: 'matters:view',
  collection: 'matters:view',
  documents: 'documents:view',
  tasks: 'tasks:view',
  calendar: 'calendar:view',
  notifications: 'notifications:view',
  contracts: 'contracts:view',
  finance: 'receivables:view',
  reports: 'reports:view',
  admin: 'users:view',
  pipelines: 'pipelines:view',
  audit: 'audit:view',
};

const navGroups: readonly NavGroup[] = [
  {
    label: 'Principal',
    items: [
      ['portal', 'Minha área', 'MA'],
      ['dashboard', 'Visão geral', 'VG'],
      ['clients', 'Clientes', 'CL'],
      ['matters', 'Processos', 'PR'],
    ],
  },
  {
    label: 'Operação',
    items: [
      ['commercial', 'CRM comercial', 'CM'],
      ['legal', 'CRM jurídico', 'CJ'],
      ['collection', 'Cobrança', 'CO'],
      ['documents', 'Documentos', 'DO'],
      ['tasks', 'Tarefas', 'TA'],
      ['calendar', 'Agenda', 'AG'],
      ['notifications', 'Notificações', 'NO'],
    ],
  },
  {
    label: 'Financeiro',
    items: [
      ['contracts', 'Contratos', 'CT'],
      ['finance', 'Recebíveis', 'RE'],
      ['reports', 'Relatórios', 'RL'],
    ],
  },
  {
    label: 'Administração',
    items: [
      ['admin', 'Usuários e permissões', 'US'],
      ['pipelines', 'Pipelines', 'PI'],
      ['audit', 'Auditoria', 'AU'],
    ],
  },
] as const;

const nav: readonly NavItem[] = navGroups.flatMap((group) => [...group.items]);

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
function Notice({ error, onRetry }: { error?: ApiError; onRetry?: () => void }) {
  if (!error) return null;
  const message =
    error.status === 403
      ? 'Acesso negado para esta operacao.'
      : error.status === 401
        ? 'Sua sessao expirou. Entre novamente.'
        : error.message;
  return (
    <div role="alert" className="notice notice-error">
      {message}
      {onRetry && <button onClick={onRetry}>Tentar novamente</button>}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="empty">
      <strong>Nenhum registro para mostrar</strong>
      <span>{children}</span>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" aria-label="Carregando">
      <i />
      <i />
      <i />
    </div>
  );
}

export function LegalCrm() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [menuOpen, setMenuOpen] = useState(false);
  const loadSession = useCallback(async () => {
    try {
      setSession(await api<Session>('/auth/me'));
    } catch (e) {
      setSession(null);
      if (e instanceof ApiError && e.status !== 401) setError(e);
    }
  }, []);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    if (session?.user.permissions?.includes('notifications:update')) {
      void api('/notifications/reconcile', { method: 'POST' }).catch(() => undefined);
    }
  }, [session]);
  const logout = async () => {
    try {
      await resetApiSession();
    } finally {
      setSession(null);
    }
  };
  if (session === undefined)
    return (
      <main className="auth-screen">
        <Loading />
      </main>
    );
  if (!session) return <Login onAuthenticated={loadSession} />;
  const permissions = new Set(session.user.permissions ?? []);
  const canOpen = (id: string) =>
    permissions.has(navPermissions[id] ?? '') &&
    (id !== 'portal' || Boolean(session.user.clientId));
  const availableNav = nav.filter(([id]) => canOpen(id));
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(([id]) => canOpen(id)) }))
    .filter((group) => group.items.length);
  const safeActive = canOpen(active) ? active : (availableNav[0]?.[0] ?? 'notifications');
  return (
    <div className="crm-shell">
      <aside className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'} id="primary-navigation">
        <ProductBrand inverse />
        <nav aria-label="Navegacao principal">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(([id, name, icon]) => (
                <button
                  key={id}
                  className={safeActive === id ? 'nav-active' : ''}
                  aria-current={safeActive === id ? 'page' : undefined}
                  onClick={() => {
                    setActive(id);
                    setMenuOpen(false);
                  }}
                >
                  <span aria-hidden="true">{icon}</span>
                  {name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <b>{session.user.name ?? session.user.email}</b>
          <small>{session.organization.name ?? session.organization.slug}</small>
          <button onClick={logout}>Sair</button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main className="main">
        <header className="app-header">
          <button
            className="menu-button"
            aria-label="Abrir navegacao"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">☰</span> Menu
          </button>
          <div className="current-module">
            <small>Você está em</small>
            <strong>{nav.find(([id]) => id === safeActive)?.[1] ?? 'Módulo'}</strong>
          </div>
          <GlobalSearch
            permissions={session.user.permissions ?? []}
            onOpen={(id, type) => {
              if (type === 'cliente') setSelectedClientId(id);
              setActive(type === 'cliente' ? 'clients' : 'matters');
            }}
          />
          <div className="user-chip" title={session.user.email}>
            <span aria-hidden="true">
              {(session.user.name ?? session.user.email).slice(0, 1).toUpperCase()}
            </span>
            <small>{session.user.name ?? session.user.email}</small>
          </div>
        </header>
        <Notice
          error={error}
          onRetry={() => {
            setError(undefined);
            void loadSession();
          }}
        />
        <Content
          active={safeActive}
          setActive={setActive}
          permissions={session.user.permissions ?? []}
          clientId={session.user.clientId}
          selectedClientId={selectedClientId}
          clearSelectedClient={() => setSelectedClientId(undefined)}
          openClient={(id) => {
            setSelectedClientId(id);
            setActive('clients');
          }}
        />
      </main>
    </div>
  );
}

function Login({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'recovery'>('login');
  const [error, setError] = useState<ApiError>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('authError')) {
      setError(new ApiError(400, 'O link de acesso expirou ou já foi utilizado. Solicite outro.'));
    }
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === 'login') {
        const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({
          email: String(data.get('email')),
          password: String(data.get('password')),
        });
        if (authError) throw new ApiError(401, 'E-mail ou senha inválidos.');
        await onAuthenticated();
      } else {
        const { error: authError } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(
          String(data.get('email')),
          { redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password` },
        );
        if (authError) throw new ApiError(400, 'Não foi possível solicitar a recuperação.');
        setSent(true);
      }
    } catch (e) {
      if (e instanceof ApiError) setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-screen">
      <div className="auth-layout">
        <aside className="auth-intro" aria-label="Apresentação do sistema">
          <ProductBrand inverse />
          <div>
            <p className="auth-eyebrow">Gestão clara, decisões seguras</p>
            <h1>Suas finanças sob controle, do contrato ao recebimento.</h1>
            <p>
              Acompanhe clientes, cobranças, contratos e resultados em uma visão única e confiável.
            </p>
          </div>
          <ul>
            <li>Valores e vencimentos organizados</li>
            <li>Operação protegida por permissões</li>
            <li>Histórico financeiro auditável</li>
          </ul>
        </aside>
        <section className="auth-card">
          <ProductBrand compact />
          <p className="auth-eyebrow">Área segura</p>
          <h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Recupere o acesso'}</h2>
          <p>
            {mode === 'login'
              ? 'Entre para acessar o controle financeiro da sua organização.'
              : 'Enviaremos instruções caso exista uma conta compatível.'}
          </p>
          {sent ? (
            <div className="notice notice-success">Solicitação recebida. Verifique seu e-mail.</div>
          ) : (
            <form onSubmit={submit}>
              <label>
                E-mail
                <input required name="email" type="email" autoComplete="email" />
              </label>
              {mode === 'login' && (
                <label>
                  Senha
                  <input required name="password" type="password" autoComplete="current-password" />
                </label>
              )}
              <Notice error={error} />
              <button className="primary" disabled={busy}>
                {busy
                  ? 'Aguarde...'
                  : mode === 'login'
                    ? 'Entrar no sistema'
                    : 'Solicitar recuperação'}
              </button>
            </form>
          )}
          <button
            className="link-button"
            onClick={() => {
              setMode(mode === 'login' ? 'recovery' : 'login');
              setSent(false);
              setError(undefined);
            }}
          >
            {mode === 'login' ? 'Esqueci minha senha' : 'Voltar para entrar'}
          </button>
          <small className="auth-help">
            Problemas para entrar? Fale com o administrador da sua organização.
          </small>
        </section>
      </div>
    </main>
  );
}

function Content({
  active,
  setActive,
  permissions,
  clientId,
  selectedClientId,
  clearSelectedClient,
  openClient,
}: {
  active: string;
  setActive: (value: string) => void;
  permissions: readonly string[];
  clientId?: string;
  selectedClientId?: string;
  clearSelectedClient: () => void;
  openClient: (id: string) => void;
}) {
  if (active === 'portal' && clientId)
    return <ClientPortalModule clientId={clientId} permissions={permissions} />;
  if (active === 'dashboard')
    return <OperationalDashboard navigate={setActive} permissions={permissions} />;
  if (active === 'clients')
    return (
      <ClientManagement
        initialClientId={selectedClientId}
        permissions={permissions}
        onSelectedClientChange={(id) => {
          if (!id) clearSelectedClient();
        }}
      />
    );
  if (active === 'matters' || ['commercial', 'legal', 'collection'].includes(active))
    return (
      <MatterBoard
        kind={
          active === 'commercial'
            ? 'COMMERCIAL'
            : active === 'collection'
              ? 'COLLECTION'
              : active === 'legal'
                ? 'LEGAL'
                : undefined
        }
        permissions={permissions}
        title={
          active === 'commercial'
            ? 'CRM comercial'
            : active === 'collection'
              ? 'CRM de cobranca'
              : 'CRM juridico'
        }
      />
    );
  if (active === 'tasks') return <TasksModule permissions={permissions} />;
  if (active === 'calendar') return <CalendarModule permissions={permissions} />;
  if (active === 'reports') return <ReportsCenter permissions={permissions} />;
  if (active === 'admin') return <TeamManagement permissions={permissions} />;
  if (active === 'notifications')
    return (
      <NotificationsCenter
        openClient={openClient}
        openModule={setActive}
        permissions={permissions}
      />
    );
  if (active === 'pipelines') return <PipelinesModule permissions={permissions} />;
  if (active === 'audit') return <AuditModule />;
  if (active === 'contracts') return <ContractsModule permissions={permissions} />;
  if (active === 'finance') return <FinanceOperations permissions={permissions} />;
  if (active === 'documents') return <DocumentsModule permissions={permissions} />;
  return <Unavailable title={nav.find(([id]) => id === active)?.[1] ?? 'Modulo'} />;
}

function MatterBoard({
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
  const {
    data: pipelines,
    error: pipeError,
    reload: reloadPipes,
  } = useLoad<Pipeline[]>(canViewPipelines ? '/pipelines' : undefined);
  const { data: clientPage, error: clientsError } = useLoad<Page<Client>>(
    canCreate ? '/clients?pageSize=100' : undefined,
  );
  const { data: matters, error, reload } = useLoad<Page<Matter>>('/matters?pageSize=100');
  const [moving, setMoving] = useState<string>();
  const [showForm, setShowForm] = useState(false);
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
        error={pipeError ?? clientsError ?? error}
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
        selectedPipelines.map((pipeline) => (
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
                      <span>{filtered.filter((m) => m.currentStage?.id === stage.id).length}</span>
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
                                <option value="">Sem etapa</option>
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
        ))
      ) : (
        <Empty>Crie e configure um pipeline antes de movimentar processos.</Empty>
      )}
    </section>
  );
}

function Unavailable({ title }: { title: string }) {
  return (
    <section>
      <Title
        title={title}
        description="Este modulo depende de endpoints de consulta que ainda nao sao expostos pela API."
      />
      <div className="surface empty">
        <strong>Funcionalidade indisponivel no contrato atual</strong>
        <span>
          Nenhum dado foi inventado. Publique endpoints de listagem e consulta para habilitar esta
          tela.
        </span>
      </div>
    </section>
  );
}
function Title({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <p>Controle Financeiro Lívio</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {action}
    </header>
  );
}
function GlobalSearch({
  onOpen,
  permissions,
}: {
  onOpen: (id: string, type: string) => void;
  permissions: readonly string[];
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<{ clients: Client[]; matters: Matter[] }>({
    clients: [],
    matters: [],
  });
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults({ clients: [], matters: [] });
      return;
    }
    const timer = setTimeout(() => {
      controller.current?.abort();
      const signal = new AbortController();
      controller.current = signal;
      const clientsRequest = permissions.includes('clients:view')
        ? api<Page<Client>>(
            `/clients?search=${encodeURIComponent(term)}&pageSize=5`,
            {},
            signal.signal,
          )
        : Promise.resolve({ items: [], total: 0 });
      const mattersRequest = permissions.includes('matters:view')
        ? api<Page<Matter>>(
            `/matters?search=${encodeURIComponent(term)}&pageSize=5`,
            {},
            signal.signal,
          )
        : Promise.resolve({ items: [], total: 0 });
      Promise.all([clientsRequest, mattersRequest])
        .then(([clients, matters]) =>
          setResults({ clients: clients.items, matters: matters.items }),
        )
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [permissions, term]);
  return (
    <div className="global-search">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar cliente, processo, CPF, e-mail..."
        aria-label="Busca global"
      />
      {results.clients.length || results.matters.length ? (
        <div className="search-results">
          {results.clients.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onOpen(item.id, 'cliente');
                setTerm('');
              }}
            >
              Cliente: {item.displayName}
            </button>
          ))}
          {results.matters.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onOpen(item.id, 'processo');
                setTerm('');
              }}
            >
              Processo: {item.reference} - {item.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
