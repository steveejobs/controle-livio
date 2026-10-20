'use client';

import { useState } from 'react';

export function PasswordField({
  id,
  label,
  name,
  autoComplete,
  minLength,
  visibilityLabel,
}: {
  id: string;
  label: string;
  name: string;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
  visibilityLabel?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field__control">
        <input
          id={id}
          required
          minLength={minLength}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-field__toggle"
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel ?? label.toLocaleLowerCase('pt-BR')}`}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  );
}
