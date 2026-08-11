# ADR 0005: Tema central, componentes por domínio e motion progressivo

- Status: aceito
- Data: 2026-08-07

## Contexto

A interface precisa crescer sem divergência visual, manter alta ergonomia e oferecer transições sem sacrificar acessibilidade, desempenho ou funcionamento sem JavaScript.

## Decisão

Centralizar tokens, motion e interações em `apps/web/theme`. Composições de negócio vivem em `apps/web/features`, comportamentos reutilizáveis em `apps/web/components` e primitivas agnósticas em `packages/ui`. Um único `IntersectionObserver` controla entrada, saída e retorno por scroll com opacidade/transform em 620 ms. Hover e spotlight de ponteiro são aprimoramentos progressivos.

## Consequências

Novas seções devem reutilizar tokens e atributos `data-reveal`, limitar stagger e respeitar `prefers-reduced-motion`. Touch, teclado e ausência de JavaScript continuam funcionais. Mudanças globais de aparência ficam revisáveis em uma pasta; componentes de domínio permanecem pequenos.
