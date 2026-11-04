# Segurança e permissões

O inventário anterior registra 130 handlers: 118 com `RequirePermission`, 4 com `AuthenticatedRoute` e 8 públicos (health, assinatura por token e schedulers com proteção própria). Isto é revisão estática, não 130 provas positivas/negativas. Nesta rodada não havia stack local descartável; Docker, Supabase CLI e psql não estavam disponíveis. O `.env` existente é documentado como vinculado ao projeto compartilhado com Production/Preview, portanto nenhuma escrita ou teste mutável foi feita nele.

| Perfil / eixo                                                                | Estado nesta rodada |
| ---------------------------------------------------------------------------- | ------------------- |
| Administrador, advogado, secretaria, financeiro e cliente contra API real    | NOT_EXECUTED        |
| Cross-tenant e cross-client em PostgreSQL/RLS/Storage                        | NOT_EXECUTED        |
| Sessão expirada, refresh SSR, convite e recuperação hospedados               | NOT_EXECUTED        |
| Scanner fail-closed, upload privado, link assinado e gateway HTTPS hospedado | NOT_EXECUTED        |

Os testes unitários e o CI anterior documentam proteções, mas não validam o checkout atual em infraestrutura real. O problema histórico de sessão expirada continua sem prova de correção hospedada.
