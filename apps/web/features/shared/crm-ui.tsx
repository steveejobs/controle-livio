'use client';

import type { ReactNode } from 'react';
import type { ApiError } from '../../lib/api';

export function Notice({ error, onRetry }: { error?: ApiError; onRetry?: () => void }) {
  if (!error) return null;
  const message =
    error.status === 403
      ? 'Acesso negado para esta operacao.'
      : error.status === 401
        ? 'Sua sessao expirou. Entre novamente.'
        : error.message;
  return (
    <div role="alert" className="notice notice-error">
      {message}
      {onRetry && <button onClick={onRetry}>Tentar novamente</button>}
    </div>
  );
}

export function Empty({ children }: { children: string }) {
  return (
    <div className="empty">
      <strong>Nenhum registro para mostrar</strong>
      <span>{children}</span>
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" aria-label="Carregando">
      <i />
      <i />
      <i />
    </div>
  );
}

export function Title({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <p>Controle Financeiro Lívio</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {action}
    </header>
  );
}
