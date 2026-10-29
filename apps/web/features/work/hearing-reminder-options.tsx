'use client';

import { useState } from 'react';

const standardReminders = [
  { minutes: 60, label: '1 hora antes' },
  { minutes: 30, label: '30 minutos antes' },
  { minutes: 10, label: '10 minutos antes' },
];

function describeMinutes(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hora' : 'horas'} antes`;
  }
  return `${minutes} minutos antes`;
}

export function HearingReminderOptions({
  value,
  onChange,
}: {
  value: readonly number[];
  onChange: (minutes: number[]) => void;
}) {
  const [customMinutes, setCustomMinutes] = useState('');
  const minutes = Number(customMinutes);
  const canAdd =
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= 10_080 &&
    value.length < 8 &&
    !value.includes(minutes);
  const add = (next: number) => onChange([...value, next].sort((left, right) => right - left));
  const remove = (next: number) => onChange(value.filter((item) => item !== next));

  return (
    <fieldset className="hearing-reminders form-wide">
      <legend>Alertas para esta audiência</legend>
      <div className="hearing-reminders__options">
        {standardReminders.map(({ minutes: interval, label }) => (
          <label className="checkbox-label" key={interval}>
            <input
              type="checkbox"
              checked={value.includes(interval)}
              disabled={!value.includes(interval) && value.length >= 8}
              onChange={(event) => (event.target.checked ? add(interval) : remove(interval))}
            />
            {label}
          </label>
        ))}
        {value
          .filter((interval) => !standardReminders.some((item) => item.minutes === interval))
          .map((interval) => (
            <span className="hearing-reminders__custom" key={interval}>
              {describeMinutes(interval)}
              <button
                type="button"
                className="table-action"
                aria-label={`Remover aviso de ${interval} minutos`}
                onClick={() => remove(interval)}
              >
                Remover
              </button>
            </span>
          ))}
      </div>
      <div className="hearing-reminders__custom-form">
        <label>
          Outro intervalo (minutos)
          <input
            type="number"
            min={1}
            max={10_080}
            step={1}
            inputMode="numeric"
            placeholder="Ex.: 45"
            value={customMinutes}
            onChange={(event) => setCustomMinutes(event.target.value)}
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={!canAdd}
          onClick={() => {
            if (!canAdd) return;
            add(minutes);
            setCustomMinutes('');
          }}
        >
          Adicionar alerta
        </button>
      </div>
      <small>
        {value.length
          ? 'Os avisos são enviados ao responsável pelo cadastro, com tolerância de até 5 minutos.'
          : 'Esta audiência ficará sem alertas. Selecione um intervalo para receber avisos.'}
      </small>
    </fieldset>
  );
}
