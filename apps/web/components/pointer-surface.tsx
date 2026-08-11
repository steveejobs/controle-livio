'use client';

import type { ComponentProps, PointerEvent } from 'react';

export function PointerSurface({
  className = '',
  onPointerMove,
  ...props
}: ComponentProps<'section'>) {
  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
    onPointerMove?.(event);
  };

  return (
    <section
      className={`pointer-surface ${className}`.trim()}
      onPointerMove={handlePointerMove}
      {...props}
    />
  );
}
