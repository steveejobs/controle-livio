'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ProductBrand } from '../../components/product-brand';
import { InstallAppButton } from '../../components/install-app-button';
import { ApiError, api, resetApiSession } from '../../lib/api';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';
import { Loading, Notice, Title } from '../shared/crm-ui';

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
const MatterBoard = dynamic(() =>
  import('../matters/matter-board').then((module) => module.MatterBoard),
);

type Page<T> = { items: T[]; total: number };
type Client = { id: string; displayName: string };
type Matter = { id: string; reference: string; title: string };
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

export function LegalCrm() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
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
    if (!menuOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.querySelector<HTMLButtonElement>('#primary-navigation button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    const closeOnDesktop = () => {
      if (window.matchMedia('(min-width: 901px)').matches) setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnDesktop);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnDesktop);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [menuOpen]);
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
        <div className="sidebar-install">
          <InstallAppButton className="sidebar-install__button" />
        </div>
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
            ref={menuButtonRef}
            className="menu-button"
            aria-label={menuOpen ? 'Fechar navegação' : 'Abrir navegação'}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span> {menuOpen ? 'Fechar' : 'Menu'}
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
          userId={session.user.id}
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
          <InstallAppButton className="install-login-button secondary" />
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
  userId,
  clientId,
  selectedClientId,
  clearSelectedClient,
  openClient,
}: {
  active: string;
  setActive: (value: string) => void;
  permissions: readonly string[];
  userId: string;
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
              : active === 'legal'
                ? 'CRM juridico'
                : 'Processos'
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
        reconcileKey={userId}
      />
    );
  if (active === 'pipelines') return <PipelinesModule permissions={permissions} />;
  if (active === 'audit') return <AuditModule />;
  if (active === 'contracts') return <ContractsModule permissions={permissions} />;
  if (active === 'finance') return <FinanceOperations permissions={permissions} />;
  if (active === 'documents') return <DocumentsModule permissions={permissions} />;
  return <Unavailable title={nav.find(([id]) => id === active)?.[1] ?? 'Modulo'} />;
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
