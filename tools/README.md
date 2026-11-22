# Ferramentas locais

Utilitários de manutenção ficam agrupados por domínio e não fazem parte do runtime web/API. Cada ferramenta deve ter ajuda CLI, dependências explícitas, modo seguro por padrão e documentação sobre entradas/saídas.

| Pasta              | Finalidade                                        |
| ------------------ | ------------------------------------------------- |
| `database`         | Provas isoladas de Prisma/PostgreSQL              |
| `images`           | Otimização local de imagens                       |
| `notifications`    | Configuração e inspeção do scheduler              |
| `performance`      | Bundle, HTTP e navegação                          |
| `qa`               | Testes, inventários atuais e runners descartáveis |
| `runtime`          | Node portátil no Windows                          |
| `scanner`          | Gateway HTTPS para ClamAV                         |
| `storage/recovery` | Contratos e ensaio de recuperação                 |
| `supabase`         | Segurança de destino, migrations e administração  |

Resultados, capturas, traces e relatórios brutos ficam fora do código: `test-results/`,
`RUNNER_TEMP` ou pasta privada explicitamente escolhida. Os históricos antigos foram
arquivados fora do repositório. Consulte [QA](qa/README.md) e a [documentação](../docs/README.md).

## Publicação

O domínio [release](release/README.md) contém a verificação do upload Vercel.
Execute `npm run release:check` antes de publicar; a CI também confere esse contrato.

## Otimização de imagens

`tools/images/optimize.py` reduz JPEG, PNG e WebP com Pillow. Ele grava em outra pasta, preserva a árvore relativa, corrige orientação EXIF, remove metadados por padrão e nunca sobrescreve o arquivo original.

```powershell
python -m pip install -r tools/images/requirements.txt
python tools/images/optimize.py assets --output optimized-assets --format keep
```

Use `--format webp` para conversão e `--keep-metadata` apenas quando metadados forem realmente necessários. O comando retorna código diferente de zero quando algum arquivo falha.
