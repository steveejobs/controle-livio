# Tema web

Esta pasta é a fonte única do sistema visual do `apps/web`.

- `tokens.css`: cores, tipografia, raios, sombras, espaçamentos e timings.
- `motion.css`: entrada/saída por `IntersectionObserver`, stagger e redução de movimento.
- `interactions.css`: foco, hover, spotlight e feedback tátil/visual.
- `product-shell.css`: composição visual do login, navegação, cabeçalho e superfícies do produto.
- `index.css`: ponto único importado pelo layout raiz depois dos estilos estruturais globais.

Componentes e features não devem criar cores, breakpoints ou timings globais novos. Para conteúdo
que aparece em runtime, use `data-reveal`; o controlador observa também as seções principais da
tela legada para manter uma migração incremental segura.
