'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@livio/ui';

type ApiState = 'checking' | 'online' | 'offline';

export function SystemHealth() {
  const [state, setState] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
    fetch(`${apiUrl}/health/live`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => setState(response.ok ? 'online' : 'offline'))
      .catch(() => setState('offline'));
    return () => controller.abort();
  }, []);

  const label = {
    checking: 'Verificando API',
    online: 'API operacional',
    offline: 'API indisponível',
  }[state];
  const tone = state === 'online' ? 'success' : state === 'checking' ? 'neutral' : 'warning';

  return (
    <Badge tone={tone} aria-live="polite">
      <span className={`status-dot status-dot--${state}`} aria-hidden="true" />
      {label}
    </Badge>
  );
}
