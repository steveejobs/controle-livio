'use client';

import { useEffect, useState } from 'react';

export function useNearViewport<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!element || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, visible]);

  return { ref: setElement, visible };
}
