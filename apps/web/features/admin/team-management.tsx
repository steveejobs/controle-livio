'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { useApiData } from '../shared/use-api-data';

type Role = { id: string; key: string; name: string };
type User = {
  id: string;
  fullName?: string;
  name?: string;
  email: string;
  status: string;
  roles?: Array<{ role: Role }>;
};

export function TeamManagement({
  permissions,
  isAdministrator,
}: {
  permissions: readonly string[];
  isAdministrator: boolean;
}) {
  const users = useApiData<User[]>('/admin/users');
  const canManageUsers = isAdministrator && permissions.includes('users:manage');
  const canViewRoles = permissions.includes('roles:view');
  const canManageRoles = isAdministrator && permissions.includes('roles:manage');
  const roles = useApiData<Role[]>(canViewRoles ? '/admin/roles' : undefined);
  const accessAlerts = useApiData<{ enabled: boolean; times: string[]; timezone: string }>(
    isAdministrator ? '/admin/access-alerts' : undefined,
  );
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [alertTimes, setAlertTimes] = useState(['09:00']);

  useEffect(() => {
    if (!accessAlerts.data) return;
    setAlertsEnabled(accessAlerts.data.enabled);
    setAlertTimes(accessAlerts.data.times.length ? accessAlerts.data.times : ['09:00']);
  }, [accessAlerts.data]);

  const setStatus = async (user: User) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api(`/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
      });
      setFeedback(user.status === 'ACTIVE' ? 'Usuário suspenso.' : 'Usuário reativado.');
      users.reload();
    } catch (caught) {
      setFeedback(`Erro: ${caught instanceof ApiError ? caught.message : 'status não alterado'}`);
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api('/admin/system-roles/reconcile', { method: 'POST' });
      setFeedback('Permissões padrão atualizadas.');
      roles.reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'permissões não atualizadas'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          fullName: form.get('fullName'),
          roleIds: [form.get('roleId')],
        }),
      });
      setFeedback(
        'Convite enviado. O profissional poderá definir a senha e entrar pelo login normal.',
      );
      target.reset();
      users.reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'não foi possível enviar o convite'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const saveAccessAlerts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    try {
      await api('/admin/access-alerts', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: alertsEnabled, times: alertTimes }),
      });
      setFeedback('Horários dos alertas de acesso salvos.');
      accessAlerts.reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'alertas não atualizados'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const operationalRoles =
    roles.data?.filter(
      ({ key }) =>
        ['lawyer', 'secretary', 'finance'].includes(key) ||
        (isAdministrator && key === 'administrator'),
    ) ?? [];
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Equipe</h1>
          <span>Convide profissionais e escolha o perfil de acesso adequado.</span>
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
      {canManageUsers && canViewRoles && (
        <form className="surface form-grid" data-reveal onSubmit={create}>
          <label>
            Nome completo
            <input required name="fullName" minLength={2} />
          </label>
          <label>
            E-mail profissional
            <input required name="email" type="email" />
          </label>
          <label>
            Perfil de acesso
            <select required name="roleId" defaultValue="">
              <option value="" disabled>
                Selecione
              </option>
              {operationalRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary form-wide" disabled={busy || !operationalRoles.length}>
            {busy ? 'Enviando…' : 'Cadastrar e enviar convite'}
          </button>
        </form>
      )}
      {isAdministrator && (
        <form className="surface form-grid" data-reveal onSubmit={saveAccessAlerts}>
          <div className="form-wide">
            <p className="eyebrow">Segurança da equipe</p>
            <h2>Resumo de acessos</h2>
            <p>Registra cada entrada e reúne os acessos em notificações nos horários escolhidos.</p>
          </div>
          {accessAlerts.error && (
            <div className="notice notice-error form-wide" role="alert">
              {accessAlerts.error.message}
            </div>
          )}
          <label className="form-wide checkbox-label">
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={(event) => setAlertsEnabled(event.target.checked)}
            />
            Receber resumo automático de acessos
          </label>
          {alertTimes.map((time, index) => (
            <label key={index}>
              Horário {index + 1}
              <span className="inline-control">
                <input
                  type="time"
                  step={300}
                  required={alertsEnabled}
                  value={time}
                  onChange={(event) =>
                    setAlertTimes((current) =>
                      current.map((value, currentIndex) =>
                        currentIndex === index ? event.target.value : value,
                      ),
                    )
                  }
                />
                {alertTimes.length > 1 && (
                  <button
                    type="button"
                    className="table-action"
                    aria-label={`Remover horário ${index + 1}`}
                    onClick={() =>
                      setAlertTimes((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Remover
                  </button>
                )}
              </span>
            </label>
          ))}
          <div className="form-wide inline-control">
            <button
              type="button"
              className="secondary"
              disabled={alertTimes.length >= 5}
              onClick={() =>
                setAlertTimes((current) => {
                  const available = ['09:00', '12:00', '15:00', '18:00', '20:00'].find(
                    (time) => !current.includes(time),
                  );
                  return available ? [...current, available] : current;
                })
              }
            >
              Adicionar horário
            </button>
            <span>Fuso horário: {accessAlerts.data?.timezone ?? 'America/Sao_Paulo'}</span>
          </div>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar horários'}
          </button>
        </form>
      )}
      {(users.error || roles.error) && (
        <div className="notice notice-error" role="alert">
          {users.error?.message || roles.error?.message}
        </div>
      )}
      <section className="section-block" data-reveal>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Equipe</p>
            <h2>Usuários cadastrados</h2>
          </div>
        </div>
        <div
          className="surface table-wrap"
          role="region"
          aria-label="Usuários cadastrados"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Profissional</th>
                <th>E-mail</th>
                <th>Perfil de acesso</th>
                <th>Status</th>
                {canManageUsers && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {users.data?.map((user) => (
                <tr key={user.id}>
                  <td>{user.fullName ?? user.name ?? '—'}</td>
                  <td>{user.email}</td>
                  <td>{user.roles?.map(({ role }) => role.name).join(', ') || '—'}</td>
                  <td>
                    <span className="badge">{user.status}</span>
                  </td>
                  {canManageUsers && (
                    <td>
                      <button
                        className="table-action"
                        disabled={busy}
                        onClick={() => void setStatus(user)}
                      >
                        {user.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canManageRoles && (
        <button className="secondary" disabled={busy} onClick={() => void reconcile()}>
          Atualizar permissões padrão
        </button>
      )}
    </section>
  );
}
