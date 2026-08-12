'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { useApiData } from '../shared/use-api-data';

type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  type: 'HEARING' | 'MEETING' | 'LEGAL_DEADLINE' | 'APPOINTMENT' | 'OTHER';
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string;
  allDay: boolean;
  recurrenceRule?: string;
};

const eventTypes = [
  ['HEARING', 'Audiência'],
  ['MEETING', 'Reunião'],
  ['LEGAL_DEADLINE', 'Prazo jurídico'],
  ['APPOINTMENT', 'Compromisso'],
  ['OTHER', 'Outro'],
] as const;

function localDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EventForm({
  event,
  busy,
  onCancel,
  onSave,
}: {
  event?: CalendarEvent;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const recurrence = String(form.get('recurrence') ?? '');
    void onSave({
      title: form.get('title'),
      description: form.get('description') || undefined,
      type: form.get('type'),
      startsAt: new Date(String(form.get('startsAt'))).toISOString(),
      endsAt: new Date(String(form.get('endsAt'))).toISOString(),
      timezone: 'America/Sao_Paulo',
      location: form.get('location') || undefined,
      allDay: form.get('allDay') === 'on',
      attendees: [],
      recurrenceRule: recurrence || undefined,
    });
  };
  return (
    <form className="surface form-grid" onSubmit={submit}>
      <label>
        Título
        <input name="title" required minLength={2} defaultValue={event?.title} />
      </label>
      <label>
        Tipo
        <select name="type" defaultValue={event?.type ?? 'MEETING'}>
          {eventTypes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Início
        <input
          name="startsAt"
          type="datetime-local"
          required
          defaultValue={localDateTime(event?.startsAt)}
        />
      </label>
      <label>
        Fim
        <input
          name="endsAt"
          type="datetime-local"
          required
          defaultValue={localDateTime(event?.endsAt)}
        />
      </label>
      <label>
        Local
        <input name="location" maxLength={500} defaultValue={event?.location} />
      </label>
      <label>
        Repetição
        <select name="recurrence" defaultValue={event?.recurrenceRule ?? ''}>
          <option value="">Não repetir</option>
          <option value="FREQ=DAILY">Diariamente</option>
          <option value="FREQ=WEEKLY">Semanalmente</option>
          <option value="FREQ=MONTHLY">Mensalmente</option>
        </select>
      </label>
      <label className="form-wide">
        Descrição
        <textarea
          name="description"
          rows={3}
          maxLength={10_000}
          defaultValue={event?.description}
        />
      </label>
      <label className="check">
        <input name="allDay" type="checkbox" defaultChecked={event?.allDay} /> Dia inteiro
      </label>
      <div className="form-actions form-wide">
        <button className="primary" disabled={busy}>
          {busy ? 'Salvando…' : event ? 'Salvar evento' : 'Criar evento'}
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Calendar({ permissions }: { permissions: readonly string[] }) {
  const events = useApiData<CalendarEvent[]>('/calendar-events');
  const [editing, setEditing] = useState<CalendarEvent | 'new'>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canCreate = permissions.includes('calendar:create');
  const canUpdate = permissions.includes('calendar:update');

  const save = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api(editing === 'new' ? '/calendar-events' : `/calendar-events/${editing?.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
      });
      setFeedback(editing === 'new' ? 'Compromisso criado.' : 'Compromisso atualizado.');
      setEditing(undefined);
      events.reload();
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'não foi possível salvar'}`);
    } finally {
      setBusy(false);
    }
  };

  const range = (event: CalendarEvent) => {
    try {
      const format = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: event.allDay ? undefined : 'short',
        timeZone: event.timezone,
      });
      return `${format.format(new Date(event.startsAt))} – ${format.format(new Date(event.endsAt))}`;
    } catch {
      return `${new Date(event.startsAt).toLocaleString('pt-BR')} – ${new Date(event.endsAt).toLocaleString('pt-BR')}`;
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Organização</p>
          <h1>Agenda</h1>
          <span>Cadastre audiências, reuniões, prazos e compromissos no horário de Brasília.</span>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setEditing('new')}>
            Novo compromisso
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
      {events.error && (
        <div role="alert" className="notice notice-error">
          {events.error.message} <button onClick={events.reload}>Tentar novamente</button>
        </div>
      )}
      {editing && (
        <EventForm
          event={editing === 'new' ? undefined : editing}
          busy={busy}
          onCancel={() => setEditing(undefined)}
          onSave={save}
        />
      )}
      {!events.data && !events.error ? (
        <div className="loading" aria-label="Carregando agenda">
          <i />
          <i />
          <i />
        </div>
      ) : events.data?.length ? (
        <div className="agenda">
          {events.data.map((event) => (
            <article className="surface" key={event.id}>
              <span>{range(event)}</span>
              <h2>{event.title}</h2>
              <p>
                {eventTypes.find(([value]) => value === event.type)?.[1] ?? event.type}
                {event.location ? ` · ${event.location}` : ''}
              </p>
              {event.description && <small>{event.description}</small>}
              {event.recurrenceRule && <small>Recorrente: {event.recurrenceRule}</small>}
              {canUpdate && (
                <button className="table-action" onClick={() => setEditing(event)}>
                  Editar
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum compromisso agendado</strong>
          <span>Use “Novo compromisso” para começar.</span>
        </div>
      )}
    </section>
  );
}
