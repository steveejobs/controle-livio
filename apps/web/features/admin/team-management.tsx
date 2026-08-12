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

export function TeamManagement() {
  const users = useApiData<User[]>('/admin/users');
  const roles = useApiData<Role[]>('/admin/roles');
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      !roles.data ||
      (roles.data.some(({ key }) => key === 'lawyer') &&
        roles.data.some(({ key }) => key === 'secretary'))
    )
      return;
    if (roles.data)
      api<Role[]>('/admin/system-roles/reconcile', { method: 'POST' })
        .then(() => roles.reload())
        .catch(() => undefined);
  }, [roles.data, roles.reload]);

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
