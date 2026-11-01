'use client';

import Image from 'next/image';
import { useEffect, useState, type ChangeEvent } from 'react';
import { api, ApiError } from '../../lib/api';

export function ClientPhoto({
  clientId,
  name,
  hasPhoto,
  canEdit,
}: {
  clientId: string;
  name: string;
  hasPhoto: boolean;
  canEdit: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (hasPhoto) {
      void api<{ url: string | null }>(`/clients/${clientId}/photo-url`)
        .then((result) => {
          if (active) setUrl(result.url);
        })
        .catch(() => {
          if (active) setError('Não foi possível carregar a foto.');
        });
    } else {
      setUrl(null);
    }
    return () => {
      active = false;
    };
  }, [clientId, hasPhoto]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (
      file.size > 5 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setError('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api<{ url: string }>(`/clients/${clientId}/photo`, {
        method: 'POST',
        body,
      });
      setUrl(result.url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar a foto.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/clients/${clientId}/photo`, { method: 'DELETE' });
      setUrl(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível remover a foto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="client-photo-block">
      <div className="client-photo-frame">
        {url ? (
          <Image src={url} alt={`Foto de ${name}`} width={96} height={96} unoptimized />
        ) : (
          <span aria-label={`Sem foto de ${name}`}>
            {name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </div>
      {canEdit && (
        <div className="client-photo-actions">
          <label className="secondary compact-action client-photo-control">
            {busy ? 'Salvando…' : url ? 'Trocar foto' : 'Enviar foto'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={upload}
              disabled={busy}
              aria-label="Selecionar foto do cliente"
            />
          </label>
          <label className="secondary compact-action client-photo-control">
            Tirar foto
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={upload}
              disabled={busy}
              aria-label="Tirar foto do cliente"
            />
          </label>
          {url && (
            <button type="button" className="text-button" onClick={remove} disabled={busy}>
              Remover foto
            </button>
          )}
        </div>
      )}
      {error && (
        <small role="alert" className="field-error">
          {error}
        </small>
      )}
    </div>
  );
}
