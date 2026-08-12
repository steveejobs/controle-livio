'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Task = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueAt?: string;
  reminders?: Array<{ id: string; remindAt: string }>;
};

const statuses = [
  ['OPEN', 'Aberta'],
  ['IN_PROGRESS', 'Em andamento'],
  ['BLOCKED', 'Bloqueada'],
  ['COMPLETED', 'Concluída'],
  ['CANCELLED', 'Cancelada'],
] as const;
const priorities = [
  ['LOW', 'Baixa'],
  ['MEDIUM', 'Média'],
  ['HIGH', 'Alta'],
  ['URGENT', 'Urgente'],
] as const;

export function Tasks({ permissions }: { permissions: readonly string[] }) {
  const tasks = useApiData<Task[]>('/tasks');
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canCreate = permissions.includes('tasks:create');
  const canUpdate = permissions.includes('tasks:update');

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      tasks.reload();
      return true;
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'operação não concluída'}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void perform(
      () =>
        api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: form.get('title'),
            description: form.get('description') || undefined,
            status: 'OPEN',
            priority: form.get('priority'),
            dueAt: form.get('dueAt')
              ? new Date(String(form.get('dueAt'))).toISOString()
              : undefined,
          }),
        }),
      'Tarefa criada.',
    ).then((ok) => {
      if (ok) {
        target.reset();
        setShowForm(false);
      }
    });
  };

  const update = (task: Task, changes: Record<string, unknown>) =>
    perform(
      () => api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
      'Tarefa atualizada.',
    );

  const addDetail = (
    event: FormEvent<HTMLFormElement>,
    task: Task,
    kind: 'comment' | 'reminder',
  ) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const path = kind === 'comment' ? 'comments' : 'reminders';
    const payload =
      kind === 'comment'
        ? { body: form.get('body') }
        : { remindAt: new Date(String(form.get('remindAt'))).toISOString() };
    void perform(
      () => api(`/tasks/${task.id}/${path}`, { method: 'POST', body: JSON.stringify(payload) }),
      kind === 'comment' ? 'Comentário adicionado.' : 'Lembrete programado.',
    ).then((ok) => {
      if (ok) target.reset();
    });
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Operação</p>
          <h1>Tarefas</h1>
          <span>Crie, priorize, acompanhe, conclua e programe lembretes.</span>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Fechar' : 'Nova tarefa'}
          </button>
        )}
      </header>
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
            Título
            <input name="title" required minLength={2} />
          </label>
          <label>
            Prioridade
            <select name="priority" defaultValue="MEDIUM">
              {priorities.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prazo
            <input name="dueAt" type="datetime-local" />
          </label>
          <label className="form-wide">
            Descrição
            <textarea name="description" rows={3} maxLength={10_000} />
          </label>
          <button className="primary form-wide" disabled={busy}>
            Criar tarefa
          </button>
        </form>
      )}
      {tasks.error && (
        <div role="alert" className="notice notice-error">
          {tasks.error.message} <button onClick={tasks.reload}>Tentar novamente</button>
        </div>
      )}
      {!tasks.data && !tasks.error ? (
        <div className="loading" aria-label="Carregando tarefas">
          <i />
          <i />
          <i />
        </div>
      ) : tasks.data?.length ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Prioridade</th>
                <th>Status</th>
                <th>Prazo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tasks.data.map((task) => (
                <Fragment key={task.id}>
                  <tr>
                    <td>
                      <strong>{task.title}</strong>
                      <small>{task.description}</small>
                    </td>
                    <td>
                      {canUpdate ? (
                        <select
                          value={task.priority}
                          disabled={busy}
                          onChange={(event) => void update(task, { priority: event.target.value })}
                          aria-label={`Prioridade de ${task.title}`}
                        >
                          {priorities.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        priorities.find(([value]) => value === task.priority)?.[1]
                      )}
                    </td>
                    <td>
                      {canUpdate ? (
                        <select
                          value={task.status}
                          disabled={busy}
                          onChange={(event) => void update(task, { status: event.target.value })}
                          aria-label={`Status de ${task.title}`}
                        >
                          {statuses.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        statuses.find(([value]) => value === task.status)?.[1]
                      )}
                    </td>
                    <td>{formatDate(task.dueAt)}</td>
                    <td>
                      {canUpdate && (
                        <button
                          className="table-action"
                          onClick={() => setExpanded(expanded === task.id ? undefined : task.id)}
                        >
                          {expanded === task.id ? 'Fechar' : 'Detalhes'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === task.id && (
                    <tr>
                      <td className="expanded-cell" colSpan={5}>
                        <div className="client-grid">
                          <form
                            className="stack-form"
                            onSubmit={(event) => addDetail(event, task, 'comment')}
                          >
                            <label>
                              Comentário
                              <textarea required name="body" rows={2} />
                            </label>
                            <button className="secondary" disabled={busy}>
                              Adicionar comentário
                            </button>
                          </form>
                          <form
                            className="stack-form"
                            onSubmit={(event) => addDetail(event, task, 'reminder')}
                          >
                            <label>
                              Lembrar em
                              <input required name="remindAt" type="datetime-local" />
                            </label>
                            <button className="secondary" disabled={busy}>
                              Programar lembrete
                            </button>
                            {!!task.reminders?.length && (
                              <small>{task.reminders.length} lembrete(s) pendente(s)</small>
                            )}
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhuma tarefa</strong>
          <span>Use “Nova tarefa” para começar.</span>
        </div>
      )}
    </section>
  );
}
