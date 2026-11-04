# OCR e documentos

## Referências do proprietário

Foram inspecionados localmente os dois caminhos informados em Downloads. Um é um comprovante de pagamento em PNG; o outro, uma fotografia de RG em JPEG. Ambos parecem conter dados pessoais reais. Não foram copiados ao repositório, enviados ao OCR da aplicação, a CI ou a terceiros, nem transcritos neste relatório. A autorização específica para processar documentos reais fora da inspeção local não foi presumida. Os testes executados usaram somente fixtures sintéticas existentes.

## Cadeias atuais

- Identificação: `identification-capture.tsx` aceita JPG/PNG até 8 MiB, executa Tesseract português no navegador, apresenta campos editáveis e aplica nome, CPF, RG/órgão e nascimento ao formulário. PDF, CIN e CNH não têm interpretação específica. A imagem é enviada como documento depois da criação do cliente; falha de upload deixa cadastro criado e avisa o usuário.
- Comprovante: `ReceiptExtractionService` aceita PDF/JPG/PNG, texto PDF ou Tesseract local; `interpretReceiptText` reconhece campos rotulados e valor/data brasileiros. O serviço de recibos usa scanner, Storage privado, hash e revisão antes de gravar pagamento. Não há confirmação bancária externa nem autenticação do documento. O reconhecimento de estado agendado/cancelado/devolvido não foi localizado no interpretador.

## Métricas observadas, com denominador explícito

| Tipo e fonte                                              |               Corpus executado |                               Campos críticos exatos |            Invenções observadas | Limite                                                      |
| --------------------------------------------------------- | -----------------------------: | ---------------------------------------------------: | ------------------------------: | ----------------------------------------------------------- |
| Identificação, parser textual sintético                   | 4 casos, incluindo RG ilegível | Após correção, 1/1 caso de ausência de RG preservada |                  0 no caso novo | Sem medição de OCR de imagem nesta rodada                   |
| Comprovante PNG/JPEG/PDF texto/PDF digitalizado sintético |                 4 casos ideais |                                  Valor 4/4; data 4/4 | 0 verificada nesses dois campos | Não mede variedade de instituições ou qualidade fotográfica |

Essas frações são resultados dos casos executados e **não** estimativas de precisão do produto. Cobertura por RG tradicional, CIN, CNH, documento frente/verso, PIX agendado/cancelado/devolvido, boleto, nota fiscal e extrato permanece `NOT_EXECUTED` para OCR óptico. `RG` possui parser genérico; suporte operacional aos formatos específicos não foi comprovado. Critério de aprovação para o corpus futuro: CPF, valor e data precisam corresponder exatamente após normalização e nenhum campo ausente pode ser inventado; qualquer estado financeiro que não comprove liquidação deve impedir quitação automática.

## Achados

- `DEF-001`: RG ilegível seguido do órgão expedidor era inventado como `SSP/MA`; corrigido e testado.
- `DEF-002`: campos lidos podem substituir valores já preenchidos ao clicar em “Usar dados no cadastro”, sem regra visível de conflito. Revisão visual existe, mas o risco de sobrescrita merece teste de navegador e decisão de UX.
- `DEF-003`: o interpretador de comprovantes não extrai situação da operação; há caminho de confirmação manual com motivo, sem guarda explícita para comprovante agendado/cancelado/devolvido. Exige reprodução integrada antes de alterar o ledger.
