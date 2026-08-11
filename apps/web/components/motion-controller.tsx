'use client';

import { useEffect } from 'react';

const revealSelector = '[data-reveal], .main > section, .auth-screen > section';

export function MotionController() {
  useEffect(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      document
        .querySelectorAll<HTMLElement>(revealSelector)
        .forEach((element) => element.classList.add('is-visible'));
      return undefined;
    }

    root.classList.add('motion-ready');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) =>
          entry.target.classList.toggle('is-visible', entry.isIntersecting),
        );
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    );
    const observe = (container: ParentNode) => {
      container.querySelectorAll<HTMLElement>(revealSelector).forEach((element) => {
        element.dataset.reveal = '';
        observer.observe(element);
      });
    };
    observe(document);
    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) =>
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.matches(revealSelector)) {
              node.dataset.reveal = '';
              observer.observe(node);
            }
            observe(node);
          }
        }),
      );
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
      root.classList.remove('motion-ready');
    };
  }, []);

  return null;
}
