'use client';

import { useEffect } from 'react';

export function PwaRuntime() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);

  return null;
}
