'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LEGAL_SERVICES, normalizeLegalServiceName } from '@livio/shared';
import { ApiError, api } from '../../lib/api';

type SavedService = { id: string; name: string; area: 'GENERAL' | 'CRIMINAL' };

export function ServiceSelection({ disabled = false }: { disabled?: boolean }) {
  const [savedServices, setSavedServices] = useState<SavedService[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [showNewService, setShowNewService] = useState(false);
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState<'GENERAL' | 'CRIMINAL'>('GENERAL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setSavedServices(await api<SavedService[]>('/finance/service-catalog'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os serviços.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const services = useMemo(() => {
    const defaultNames = new Set(
      DEFAULT_LEGAL_SERVICES.map(({ name }) => normalizeLegalServiceName(name)),
    );
    return [
      ...DEFAULT_LEGAL_SERVICES,
      ...savedServices.filter(({ name }) => !defaultNames.has(normalizeLegalServiceName(name))),
    ];
  }, [savedServices]);

  const saveService = async () => {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      setError('Informe o nome do serviço.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const service = await api<SavedService>('/finance/service-catalog', {
        method: 'POST',
        body: JSON.stringify({ name, area: newArea }),
      });
      setSavedServices((current) => [...current, service]);
      setSelected((current) => [...new Set([...current, service.name])]);
      setNewName('');
      setShowNewService(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Não foi possível salvar o serviço.',
      );
    } finally {
      setSaving(false);
    }
  };

  const renderGroup = (area: 'GENERAL' | 'CRIMINAL', label: string) => {
    const items = services.filter((service) => service.area === area);
    if (!items.length) return null;
    return (
      <div key={area} className="service-option-group">
        <h3>{label}</h3>
        {items.map((service) => (
          <label className="checkbox-label" key={service.name}>
            <input
              type="checkbox"
              value={service.name}
              checked={selected.includes(service.name)}
              disabled={disabled}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, service.name]
                    : current.filter((name) => name !== service.name),
                )
              }
            />
            {service.name}
          </label>
        ))}
      </div>
    );
  };

  return (
    <fieldset className="service-selection form-wide" disabled={disabled}>
      <legend>Serviços incluídos no contrato</legend>
      <p className="section-note">
        Marque todos os serviços cobertos. O primeiro marcado será usado como serviço principal nos
        relatórios.
      </p>
      {loading ? (
        <p className="section-note" role="status">
          Carregando lista de serviços…
        </p>
      ) : (
        <div className="service-option-groups">
          {renderGroup('CRIMINAL', 'Jurídico criminal')}
          {renderGroup('GENERAL', 'Outros serviços jurídicos')}
        </div>
      )}
      {selected.map((name) => (
        <input key={name} type="hidden" name="serviceNames" value={name} />
      ))}
      {error && (
        <div role="alert" className="notice notice-error">
          {error}{' '}
          <button type="button" className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}
      <button
        className="secondary"
        type="button"
        aria-expanded={showNewService}
        onClick={() => {
          setError(undefined);
          setShowNewService((current) => !current);
        }}
      >
        {showNewService ? 'Cancelar novo serviço' : 'Salvar novo serviço para reutilizar'}
      </button>
      {showNewService && (
        <div className="form-grid service-create-form">
          <label>
            Nome do serviço
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Área
            <select
              value={newArea}
              onChange={(event) => setNewArea(event.target.value as typeof newArea)}
            >
              <option value="GENERAL">Outros serviços jurídicos</option>
              <option value="CRIMINAL">Jurídico criminal</option>
            </select>
          </label>
          <button
            className="secondary"
            type="button"
            disabled={saving}
            onClick={() => void saveService()}
          >
            {saving ? 'Salvando…' : 'Salvar na lista'}
          </button>
        </div>
      )}
    </fieldset>
  );
}
