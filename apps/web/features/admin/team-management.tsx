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

export function TeamManagement({ permissions }: { permissions: readonly string[] }) {
  const users = useApiData<User[]>('/admin/users');
  const canManageUsers = permissions.includes('users:manage');
  const canViewRoles = permissions.includes('roles:view');
  const canManageRoles = permissions.includes('roles:manage');
  const roles = useApiData<Role[]>(canViewRoles ? '/admin/roles' : undefined);
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      !canManageRoles ||
      !roles.data ||
      (roles.data.some(({ key }) => key === 'lawyer') &&
        roles.data.some(({ key }) => key === 'secretary'))
    )
      return;
    if (roles.data)
      api<Role[]>('/admin/system-roles/reconcile', { method: 'POST' })
        .then(() => roles.reload())
        .catch(() => undefined);
  }, [canManageRoles, roles.data, roles.reload]);

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

  const operationalRoles =
    roles.data?.filter(({ key }) => ['lawyer', 'secretary', 'finance'].includes(key)) ?? [];
  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Advogados e secretaria</h1>
          <span>
            Cadastre profissionais por convite e aplique permissões próprias para cada função.
          </span>
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
            Função
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
          <div className="role-explainer">
            <strong>Acesso por função</strong>
            <span>
              Advogado: clientes, processos, documentos e relatórios. Secretaria: cadastro, agenda,
              documentos e operação, sem gestão financeira sensível.
            </span>
          </div>
          <button className="primary form-wide" disabled={busy || !operationalRoles.length}>
            {busy ? 'Enviando…' : 'Cadastrar e enviar convite'}
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
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profissional</th>
                <th>E-mail</th>
                <th>Função</th>
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
