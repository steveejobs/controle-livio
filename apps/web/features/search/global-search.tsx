'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';

type Page<T> = { items: T[]; total: number };
type Client = { id: string; displayName: string };
type Matter = { id: string; reference: string; title: string };
type SearchResult = { id: string; label: string; type: 'cliente' | 'processo' };

export function GlobalSearch({
  onOpen,
  permissions,
}: {
  onOpen: (id: string, type: 'cliente' | 'processo') => void;
  permissions: readonly string[];
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const search = encodeURIComponent(term.trim());
      const clientsRequest = permissions.includes('clients:view')
        ? api<Page<Client>>(`/clients?search=${search}&pageSize=5`, {}, controller.signal)
        : Promise.resolve({ items: [] });
      const mattersRequest = permissions.includes('matters:view')
        ? api<Page<Matter>>(`/matters?search=${search}&pageSize=5`, {}, controller.signal)
        : Promise.resolve({ items: [] });
      void Promise.all([clientsRequest, mattersRequest]).then(
        ([clients, matters]) => {
          if (controller.signal.aborted) return;
          setResults([
            ...clients.items.map((item) => ({
              id: item.id,
              label: `Cliente: ${item.displayName}`,
              type: 'cliente' as const,
            })),
            ...matters.items.map((item) => ({
              id: item.id,
              label: `Processo: ${item.reference} - ${item.title}`,
              type: 'processo' as const,
            })),
          ]);
          setStatus('ready');
          setActiveIndex(-1);
        },
        () => {
          if (!controller.signal.aborted) setStatus('error');
        },
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [permissions, term]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  const choose = (item: SearchResult) => {
    onOpen(item.id, item.type);
    setTerm('');
    setResults([]);
    setStatus('idle');
    setOpen(false);
    setActiveIndex(-1);
  };
  const expanded = open && term.trim().length >= 2 && status === 'ready' && results.length > 0;
  return (
    <div className="global-search" ref={container}>
      <input
        role="combobox"
        aria-label="Busca global"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={
          expanded && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setTerm(next);
          setResults([]);
          setStatus(next.trim().length >= 2 ? 'loading' : 'idle');
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
          } else if (results.length && open && event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % results.length);
          } else if (results.length && open && event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
          } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
            event.preventDefault();
            const selected = results[activeIndex];
            if (selected) choose(selected);
          }
        }}
        placeholder="Buscar cliente ou processo"
      />
      {open && term.trim().length >= 2 && status !== 'ready' && (
        <div className="search-results" role="status">
          {status === 'loading' ? 'Buscando…' : 'Não foi possível buscar. Tente novamente.'}
        </div>
      )}
      {open && term.trim().length >= 2 && status === 'ready' && !results.length && (
        <div className="search-results" role="status">
          Nenhum resultado encontrado.
        </div>
      )}
      {expanded && (
        <div
          className="search-results"
          id={listboxId}
          role="listbox"
          aria-label="Resultados da busca"
        >
          {results.map((item, index) => (
            <button
              type="button"
              role="option"
              id={`${listboxId}-${index}`}
              aria-selected={activeIndex === index}
              key={`${item.type}:${item.id}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
