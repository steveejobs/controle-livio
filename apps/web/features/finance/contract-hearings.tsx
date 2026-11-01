'use client';

import { useRef, useState } from 'react';
import { HearingReminderOptions } from '../work/hearing-reminder-options';

export type ContractHearingDraft = {
  startsAt: string;
  location: string;
  reminderMinutes: number[];
};

type HearingDraft = ContractHearingDraft & { key: number };

function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ContractHearings({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (hearings: ContractHearingDraft[]) => void;
}) {
  const nextKey = useRef(1);
  const [enabled, setEnabled] = useState(false);
  const [hearings, setHearings] = useState<HearingDraft[]>([]);
  const minimumStart = localDateTime(new Date(Date.now() + 60_000));

  const createHearing = (): HearingDraft => ({
    key: nextKey.current++,
    startsAt: '',
    location: '',
    reminderMinutes: [60, 30, 10],
  });

  const publish = (next: HearingDraft[]) =>
    onChange(
      next.map(({ startsAt, location, reminderMinutes }) => ({
        startsAt,
        location,
        reminderMinutes,
      })),
    );

  const toggleHearings = (checked: boolean) => {
    setEnabled(checked);
    if (checked && !hearings.length) {
      const first = [createHearing()];
      setHearings(first);
      publish(first);
    } else if (!checked) {
      onChange([]);
    } else {
      publish(hearings);
    }
  };

  const updateHearing = (key: number, patch: Partial<HearingDraft>) => {
    const next = hearings.map((hearing) =>
      hearing.key === key ? { ...hearing, ...patch } : hearing,
    );
    setHearings(next);
    if (enabled) publish(next);
  };

  const addHearing = () => {
    const next = [...hearings, createHearing()];
    setHearings(next);
    publish(next);
  };

  const removeHearing = (key: number) => {
    const next = hearings.filter((hearing) => hearing.key !== key);
    setHearings(next);
    if (enabled) publish(next);
  };

  return (
    <fieldset className="contract-hearings form-wide" disabled={disabled}>
      <legend>Audiências</legend>
      <label className="checkbox-label contract-hearings__toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggleHearings(event.target.checked)}
        />
        Este contrato inclui audiência
      </label>
      <p className="section-note">
        Para serviços sem audiência, como acompanhamento em delegacia, deixe desmarcado. As
        audiências incluídas entram como agendadas na agenda.
      </p>
      {enabled && (
        <div className="contract-hearings__list">
          {hearings.map((hearing, index) => (
            <fieldset className="contract-hearing" key={hearing.key}>
              <legend>Audiência {index + 1}</legend>
              <div className="form-grid">
                <label>
                  Data e horário
                  <input
                    type="datetime-local"
                    required
                    min={minimumStart}
                    value={hearing.startsAt}
                    onChange={(event) =>
                      updateHearing(hearing.key, { startsAt: event.target.value })
                    }
                  />
                </label>
                <label>
                  Local (opcional)
                  <input
                    maxLength={500}
                    value={hearing.location}
                    onChange={(event) =>
                      updateHearing(hearing.key, { location: event.target.value })
                    }
                  />
                </label>
              </div>
              <HearingReminderOptions
                value={hearing.reminderMinutes}
                onChange={(reminderMinutes) => updateHearing(hearing.key, { reminderMinutes })}
              />
              {hearings.length > 1 && (
                <button
                  className="table-action"
                  type="button"
                  onClick={() => removeHearing(hearing.key)}
                >
                  Remover esta audiência
                </button>
              )}
            </fieldset>
          ))}
          <button
            className="secondary"
            type="button"
            disabled={hearings.length >= 20}
            onClick={addHearing}
          >
            Adicionar outra audiência
          </button>
        </div>
      )}
    </fieldset>
  );
}
