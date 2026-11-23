'use client';

import { useId, type ChangeEventHandler } from 'react';

export type ClientSelectOption = { id: string; displayName: string };

type ClientSelectFieldProps = {
  items?: readonly ClientSelectOption[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  canListClients: boolean;
  required?: boolean;
  allowUnlinked?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  disabled?: boolean;
};

export function ClientSelectField({
  items,
  loading,
  error,
  onRetry,
  canListClients,
  required = false,
  allowUnlinked = false,
  name,
  value,
  defaultValue = '',
  onChange,
  disabled = false,
}: ClientSelectFieldProps) {
  const statusId = useId();
  const isLoading = canListClients && (loading || (!items && !error));
  const hasError = canListClients && Boolean(error) && !items;
  const hasNoClients = canListClients && items !== undefined && items.length === 0;
  const statusMessage = !canListClients
    ? 'Seu perfil não pode listar clientes deste escritório.'
    : isLoading
      ? 'Carregando clientes que seu perfil pode acessar…'
      : hasError
        ? `Não foi possível carregar os clientes. ${error}`
        : hasNoClients
          ? 'Nenhum cliente acessível está cadastrado neste escritório.'
          : undefined;
  const placeholder = isLoading
    ? 'Carregando clientes…'
    : hasError
      ? 'Não foi possível carregar clientes'
      : allowUnlinked
        ? 'Sem vínculo com cliente'
        : hasNoClients
          ? 'Nenhum cliente disponível'
          : !canListClients
            ? 'Lista de clientes indisponível para este perfil'
            : 'Selecione um cliente';

  return (
    <>
      <label>
        Cliente
        <select
          name={name}
          required={required}
          disabled={disabled || isLoading}
          aria-busy={isLoading || undefined}
          aria-describedby={statusMessage ? statusId : undefined}
          {...(value !== undefined ? { value, onChange } : { defaultValue, onChange })}
        >
          <option value="" disabled={required}>
            {placeholder}
          </option>
          {items?.map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </select>
      </label>
      {statusMessage && (
        <div
          id={statusId}
          className={hasError ? 'notice notice-error form-wide' : 'section-note form-wide'}
          role={hasError ? 'alert' : 'status'}
        >
          {statusMessage}{' '}
          {hasError && (
            <button type="button" className="secondary" onClick={onRetry}>
              Tentar carregar clientes novamente
            </button>
          )}
        </div>
      )}
    </>
  );
}
