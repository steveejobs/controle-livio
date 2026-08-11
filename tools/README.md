# Ferramentas locais

Utilitários de manutenção ficam agrupados por domínio e não fazem parte do runtime web/API. Cada ferramenta deve ter ajuda CLI, dependências explícitas, modo seguro por padrão e documentação sobre entradas/saídas.

## Imagens

`tools/images/optimize.py` reduz JPEG, PNG e WebP com Pillow. Ele grava em outra pasta, preserva a árvore relativa, corrige orientação EXIF, remove metadados por padrão e nunca sobrescreve o arquivo original.

```powershell
python -m pip install -r tools/images/requirements.txt
python tools/images/optimize.py assets --output optimized-assets --format keep
```

Use `--format webp` para conversão e `--keep-metadata` apenas quando metadados forem realmente necessários. O comando retorna código diferente de zero quando algum arquivo falha.
