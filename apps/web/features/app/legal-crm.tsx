'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ProductBrand } from '../../components/product-brand';
import { ApiError, api, downloadApiFile, resetApiSession } from '../../lib/api';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';

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
  updatedAt?: string;
};
type Stage = { id: string; name: string; color?: string; position: number; isTerminal?: boolean };
type Pipeline = {
  id: string;
  name: string;
  kind: 'COMMERCIAL' | 'LEGAL' | 'COLLECTION';
  stages: Stage[];
};
type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt?: string;
  description?: string;
};
type Event = {
  id: string;
  title: string;
  type: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string;
};
type Session = {
  user: { id: string; name?: string; email: string; permissions?: string[] };
  organization: { name?: string; slug?: string };
};
type Summary = {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
  generatedAt: string;
};

type NavItem = readonly [id: string, name: string, icon: string];
type NavGroup = { label: string; items: readonly NavItem[] };

const navGroups: readonly NavGroup[] = [
  {
    label: 'Principal',
    items: [
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
const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(value))
    : 'Sem prazo';

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
  return (
    <div className="crm-shell">
      <aside className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'} id="primary-navigation">
        <ProductBrand inverse />
        <nav aria-label="Navegacao principal">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(([id, name, icon]) => (
                <button
                  key={id}
                  className={active === id ? 'nav-active' : ''}
                  aria-current={active === id ? 'page' : undefined}
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
            <strong>{nav.find(([id]) => id === active)?.[1] ?? 'Módulo'}</strong>
          </div>
          <GlobalSearch
            onOpen={(id, type) => {
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
        <Content active={active} setActive={setActive} />
      </main>
    </div>
  );
}

function Login({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'recovery'>('login');
  const [error, setError] = useState<ApiError>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
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

function Content({ active, setActive }: { active: string; setActive: (value: string) => void }) {
  if (active === 'dashboard') return <Dashboard setActive={setActive} />;
  if (active === 'clients') return <Clients />;
  if (active === 'matters' || ['commercial', 'legal', 'collection'].includes(active))
    return (
      <MatterBoard
        kind={
          active === 'commercial'
            ? 'COMMERCIAL'
            : active === 'collection'
              ? 'COLLECTION'
              : undefined
        }
        title={
          active === 'commercial'
            ? 'CRM comercial'
            : active === 'collection'
              ? 'CRM de cobranca'
              : 'CRM juridico'
        }
      />
    );
  if (active === 'tasks') return <Tasks />;
  if (active === 'calendar') return <Calendar />;
  if (active === 'reports') return <Reports />;
  if (active === 'admin') return <Admin />;
  if (active === 'pipelines') return <Pipelines />;
  if (active === 'audit') return <Audit />;
  if (active === 'contracts') return <FinanceList kind="contracts" />;
  if (active === 'finance') return <FinanceList kind="receivables" />;
  if (active === 'documents') return <Documents />;
  return <Unavailable title={nav.find(([id]) => id === active)?.[1] ?? 'Modulo'} />;
}

const currency = (value?: string, code = 'BRL') =>
  value
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(Number(value))
    : '-';
type FinanceItem = {
  id: string;
  reference?: string;
  number?: string;
  title?: string;
  description?: string;
  status: string;
  amount?: string;
  originalAmount?: string;
  fixedAmount?: string;
  currency: string;
  dueDate?: string;
  paidAt?: string;
  client?: { displayName: string };
};
function FinanceList({ kind }: { kind: 'contracts' | 'receivables' }) {
  const { data, error, reload } = useLoad<Page<FinanceItem>>(`/finance/${kind}?pageSize=50`);
  const title = kind === 'contracts' ? 'Contratos' : 'Parcelas e recebiveis';
  return (
    <section>
      <Title
        title={title}
        description="Dados financeiros registrados e calculados pela API. Valores sao retornados como Decimal serializado."
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Cliente</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.number ?? item.reference ?? item.title}</strong>
                    <small>{item.title ?? item.description}</small>
                  </td>
                  <td>{item.client?.displayName ?? '-'}</td>
                  <td>{currency(item.originalAmount ?? item.fixedAmount, item.currency)}</td>
                  <td>
                    <span className="badge">{asText(item.status)}</span>
                  </td>
                  <td>{date(item.dueDate ?? item.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nenhum registro financeiro encontrado.</Empty>
      )}
    </section>
  );
}
type DocumentItem = {
  id: string;
  title: string;
  category?: string;
  visibility: string;
  updatedAt: string;
  versions?: { fileName: string }[];
};
function Documents() {
  const { data, error, reload } = useLoad<Page<DocumentItem>>('/documents?pageSize=50');
  return (
    <section>
      <Title
        title="Documentos"
        description="Arquivos privados com versoes e acesso temporario assinado pela API."
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Categoria</th>
                <th>Visibilidade</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small>{item.versions?.[0]?.fileName}</small>
                  </td>
                  <td>{item.category ?? '-'}</td>
                  <td>{item.visibility === 'CLIENT' ? 'Visivel ao cliente' : 'Interno'}</td>
                  <td>{date(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nenhum documento no seu escopo.</Empty>
      )}
    </section>
  );
}

function Dashboard({ setActive }: { setActive: (value: string) => void }) {
  const { data, error, reload } = useLoad<Summary>('/dashboard/summary');
  const cards = data
    ? [
        ['Clientes ativos', data.activeClients, 'clients'],
        ['Processos ativos', data.activeMatters, 'matters'],
        ['Titulos vencidos', data.overdueReceivables, 'finance'],
        ['Tarefas abertas', data.openTasks, 'tasks'],
      ]
    : [];
  return (
    <section>
      <Title
        title="Visao geral"
        description="Indicadores operacionais calculados pela API no momento da consulta."
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : (
        <>
          <div className="metric-grid">
            {cards.map(([label, value, target]) => (
              <button
                className="metric"
                key={String(label)}
                onClick={() => setActive(String(target))}
              >
                <span>{label}</span>
                <strong>{value}</strong>
                <small>Ver registros</small>
              </button>
            ))}
          </div>
          <section className="surface">
            <h2>Definicoes dos indicadores</h2>
            <dl className="definitions">
              <div>
                <dt>Clientes ativos</dt>
                <dd>Clientes nao arquivados da organizacao.</dd>
              </div>
              <div>
                <dt>Processos ativos</dt>
                <dd>Processos com status ativo.</dd>
              </div>
              <div>
                <dt>Titulos vencidos</dt>
                <dd>Recebiveis em aberto, parciais ou vencidos com vencimento anterior a hoje.</dd>
              </div>
              <div>
                <dt>Tarefas abertas</dt>
                <dd>Tarefas abertas, em andamento ou bloqueadas.</dd>
              </div>
            </dl>
            {data && (
              <small>
                Atualizado em {date(data.generatedAt)}. Valores financeiros detalhados dependem dos
                relatorios e endpoints financeiros.
              </small>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function Clients() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data, error, reload } = useLoad<Page<Client>>(
    `/clients?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    300,
  );
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api('/clients', {
      method: 'POST',
      body: JSON.stringify({
        type: form.get('type'),
        displayName: form.get('displayName'),
        email: form.get('email') || undefined,
        phone: form.get('phone') || undefined,
        taxId: form.get('taxId') || undefined,
      }),
    });
    setShowForm(false);
    await reload();
  };
  return (
    <section>
      <Title
        title="Clientes"
        description="Cadastro centralizado e pesquisa por nome, documento, telefone ou e-mail."
        action={
          <button className="primary" onClick={() => setShowForm(!showForm)}>
            Novo cliente
          </button>
        }
      />
      {showForm && (
        <form className="surface inline-form" onSubmit={(e) => void create(e)}>
          <label>
            Tipo
            <select name="type" defaultValue="PERSON">
              <option value="PERSON">Pessoa fisica</option>
              <option value="COMPANY">Pessoa juridica</option>
            </select>
          </label>
          <label>
            Nome
            <input name="displayName" required minLength={2} />
          </label>
          <label>
            CPF/CNPJ
            <input name="taxId" />
          </label>
          <label>
            E-mail
            <input name="email" type="email" />
          </label>
          <label>
            Telefone
            <input name="phone" />
          </label>
          <button className="primary">Cadastrar</button>
        </form>
      )}
      <input
        className="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pesquisar clientes"
        aria-label="Pesquisar clientes"
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Contato</th>
                <th>Atualizacao</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.displayName}</strong>
                    <small>{client.type === 'COMPANY' ? 'Pessoa juridica' : 'Pessoa fisica'}</small>
                  </td>
                  <td>{client.taxIdNormalized ?? '-'}</td>
                  <td>{client.email ?? client.phone ?? '-'}</td>
                  <td>{date(client.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Cadastre um cliente para iniciar o relacionamento.</Empty>
      )}
    </section>
  );
}

function MatterBoard({ kind, title }: { kind?: Pipeline['kind']; title: string }) {
  const {
    data: pipelines,
    error: pipeError,
    reload: reloadPipes,
  } = useLoad<Pipeline[]>('/pipelines');
  const { data: matters, error, reload } = useLoad<Page<Matter>>('/matters?pageSize=100');
  const [moving, setMoving] = useState<string>();
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
  return (
    <section>
      <Title
        title={title}
        description="Etapas e historico sao mantidos pela API. Mova por seletor para operar tambem por teclado."
      />
      <Notice
        error={pipeError ?? error}
        onRetry={() => {
          void reload();
          void reloadPipes();
        }}
      />
      {(!pipelines || !matters) && !(pipeError || error) ? (
        <Loading />
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

function Tasks() {
  const { data, error, reload } = useLoad<Task[]>('/tasks');
  return (
    <section>
      <Title
        title="Tarefas"
        description="Prioridades, prazos e estado de conclusao sao sincronizados com a API."
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Prioridade</th>
                <th>Status</th>
                <th>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </td>
                  <td>
                    <span className={`badge priority-${item.priority.toLowerCase()}`}>
                      {asText(item.priority)}
                    </span>
                  </td>
                  <td>{asText(item.status)}</td>
                  <td>{date(item.dueAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nenhuma tarefa em seu escopo.</Empty>
      )}
    </section>
  );
}
function Calendar() {
  const { data, error, reload } = useLoad<Event[]>('/calendar-events');
  return (
    <section>
      <Title
        title="Agenda"
        description="Eventos sao exibidos no fuso horario informado no cadastro."
      />
      <Notice error={error} onRetry={reload} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        <div className="agenda">
          {data.map((item) => (
            <article className="surface" key={item.id}>
              <span>{date(item.startsAt)}</span>
              <h2>{item.title}</h2>
              <p>
                {asText(item.type)}
                {item.location ? ` - ${item.location}` : ''}
              </p>
              <small>{item.timezone}</small>
            </article>
          ))}
        </div>
      ) : (
        <Empty>Nenhum compromisso agendado.</Empty>
      )}
    </section>
  );
}
function Reports() {
  const [report, setReport] = useState('aging');
  const { data, error, reload } = useLoad<unknown>(`/reports/${report}`);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ApiError>();
  const exportCsv = async () => {
    setExporting(true);
    setExportError(undefined);
    try {
      await downloadApiFile(`/reports/${report}/export.csv`, `livio-${report}.csv`);
    } catch (caught) {
      setExportError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'Não foi possível baixar o relatório.'),
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <section>
      <Title
        title="Relatorios"
        description="Os resultados mantem a base contabil explicita informada pela API."
        action={
          <button className="secondary" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'Exportando...' : 'Exportar CSV'}
          </button>
        }
      />
      <div className="filters">
        <label>
          Relatorio
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            <option value="aging">Aging por vencimento</option>
            <option value="received">Recebimentos (caixa)</option>
            <option value="accrual">Competencia</option>
            <option value="overdue">Titulos vencidos</option>
            <option value="cash-forecast">Previsao de caixa</option>
            <option value="partial-payments">Pagamentos parciais</option>
            <option value="delinquent-clients">Clientes inadimplentes</option>
          </select>
        </label>
      </div>
      <Notice error={exportError ?? error} onRetry={exportError ? undefined : reload} />
      {!data && !error ? (
        <Loading />
      ) : data ? (
        <pre className="surface report-output">{JSON.stringify(data, null, 2)}</pre>
      ) : null}
    </section>
  );
}
function Admin() {
  const { data, error, reload } =
    useLoad<{ id: string; name?: string; email: string; status: string }[]>('/admin/users');
  return (
    <section>
      <Title
        title="Usuarios e permissoes"
        description="Permissoes sao sempre aplicadas pela API; esta tela reflete apenas o acesso concedido."
      />
      <Notice error={error} onRetry={reload} />
      {data?.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>E-mail</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((user) => (
                <tr key={user.id}>
                  <td>{user.name ?? '-'}</td>
                  <td>{user.email}</td>
                  <td>{user.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function Pipelines() {
  const { data, error, reload } = useLoad<Pipeline[]>('/pipelines');
  return (
    <section>
      <Title
        title="Pipelines"
        description="Configuracao de etapas comerciais, juridicas e de cobranca."
      />
      <Notice error={error} onRetry={reload} />
      {data?.length ? (
        <div className="pipeline-list">
          {data.map((p) => (
            <article className="surface" key={p.id}>
              <h2>{p.name}</h2>
              <p>{p.kind}</p>
              <ol>
                {[...p.stages]
                  .sort((a, b) => a.position - b.position)
                  .map((s) => (
                    <li key={s.id}>
                      <i style={{ backgroundColor: s.color ?? '#5f766d' }} />
                      {s.name}
                    </li>
                  ))}
              </ol>
            </article>
          ))}
        </div>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function Audit() {
  const { data, error, reload } = useLoad<
    Page<{ id: string; action: string; resource: string; createdAt: string }>
  >('/audit-logs?pageSize=100');
  return (
    <section>
      <Title title="Logs de auditoria" description="Eventos imutaveis registrados pela API." />
      <Notice error={error} onRetry={reload} />
      {data?.items.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Acao</th>
                <th>Recurso</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{date(item.createdAt)}</td>
                  <td>{item.action}</td>
                  <td>{item.resource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <Loading />
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
function GlobalSearch({ onOpen }: { onOpen: (id: string, type: string) => void }) {
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
      Promise.all([
        api<Page<Client>>(
          `/clients?search=${encodeURIComponent(term)}&pageSize=5`,
          {},
          signal.signal,
        ),
        api<Page<Matter>>(
          `/matters?search=${encodeURIComponent(term)}&pageSize=5`,
          {},
          signal.signal,
        ),
      ])
        .then(([clients, matters]) =>
          setResults({ clients: clients.items, matters: matters.items }),
        )
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);
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
function useLoad<T>(path: string, debounce = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((value) => value + 1), []);
  useEffect(() => {
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
