'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatMoney } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';

type Field = {
  value: string;
  source: 'PDF_TEXT' | 'OCR' | 'FINANCIAL_RECORD' | 'CALCULATION';
  confidence: number;
};
type Receipt = {
  id: string;
  status: string;
  documentId: string;
  installmentId?: string | null;
  expenseId?: string | null;
  extractedFields: Partial<
    Record<
      | 'paidAmount'
      | 'paidDate'
      | 'dueAmount'
      | 'nominalAmount'
      | 'discount'
      | 'interest'
      | 'penalty'
      | 'payer'
      | 'beneficiary'
      | 'documentType'
      | 'endToEndId'
      | 'transactionId'
      | 'dueDate',
      Field
    >
  >;
  reconciliation: {
    originalAmount: string;
    previousPaid: string;
    balanceBefore: string;
    paidAmount: string | null;
    expectedAmount: string | null;
    difference: string | null;
    dueAmountDifference?: string | null;
    ledgerDifference?: string | null;
    balanceAfter: string | null;
    dueDate: string;
    paidDate: string | null;
    outcome: string;
    flags?: string[];
    timing: string | null;
    warnings: string[];
  };
  document?: { id: string; title: string };
};

const outcomeLabels: Record<string, string> = {
  INCONCLUSIVE: 'Dados insuficientes',
  PARTIAL: 'Pagamento parcial',
  FULL: 'Possível quitação',
  EXCESS: 'Valor acima do saldo',
};
const flagLabels: Record<string, string> = {
  EARLY: 'Antecipado',
  LATE: 'Em atraso',
  DISCOUNT: 'Com desconto',
  INTEREST: 'Com juros',
  PENALTY: 'Com multa',
  INSUFFICIENT: 'Abaixo do valor cobrado',
  CHARGE_DIVERGENCE: 'Divergência de cobrança',
  PARTIAL_PAYMENT: 'Pagamento parcial',
};

const sourceLabels: Record<Field['source'], string> = {
  PDF_TEXT: 'Texto selecionável do PDF',
  OCR: 'Leitura OCR local',
  FINANCIAL_RECORD: 'Cadastro financeiro do Lívio',
  CALCULATION: 'Cálculo do sistema',
};

function message(error: unknown) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Operação não concluída.';
}

function displayDate(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
}

function ReceiptReview({
  receipt,
  canReview,
  onChanged,
}: {
  receipt: Receipt;
  canReview: boolean;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [current, setCurrent] = useState(receipt);
  const review = current.reconciliation;
  const fields = current.extractedFields;
  const needsReview = current.status === 'PENDING_REVIEW';
  const open = async () => {
    try {
      const result = await api<{ url: string }>(`/documents/${current.documentId}/download-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setFeedback(`Erro: ${message(error)}`);
    }
  };
  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const value = String(form.get('paidAt'));
      if (!value) throw new Error('Informe a data e a hora do pagamento.');
      await api(`/finance/receipts/${current.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          amount: String(form.get('amount')).replace(',', '.'),
          paidAt: new Date(value).toISOString(),
          method: form.get('method'),
          reference: form.get('reference'),
          correctionReason: form.get('correctionReason') || undefined,
        }),
      });
      setCurrent({ ...current, status: 'CONFIRMED' });
      setFeedback('Pagamento conferido e registrado.');
      onChanged?.();
    } catch (error) {
      setFeedback(`Erro: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (decision: 'REJECTED' | 'NEEDS_CORRECTION') => {
    const reason = window.prompt(
      decision === 'REJECTED' ? 'Motivo da rejeição' : 'O que precisa ser corrigido?',
    );
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await api(`/finance/receipts/${current.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      setCurrent({ ...current, status: decision });
      setFeedback(decision === 'REJECTED' ? 'Comprovante rejeitado.' : 'Correção solicitada.');
      onChanged?.();
    } catch (error) {
      setFeedback(`Erro: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, value: string | null | undefined, field?: Field) =>
    value ? (
      <div>
        <dt>{label}</dt>
        <dd>
          {value}
          {field && (
            <small className="receipt-field-source">
              {sourceLabels[field.source]} · revise este dado
            </small>
          )}
        </dd>
      </div>
    ) : null;
  return (
    <section className="surface stack-form" aria-label="Conferência do comprovante">
      <h3>{current.document?.title ?? 'Comprovante enviado'}</h3>
      <p>
        Estado: {current.status === 'PENDING_REVIEW' ? 'Aguardando conferência' : current.status}
      </p>
      <dl className="receipt-comparison">
        {row('Obrigação original cadastrada', formatMoney(review.originalAmount))}
        {row('Já pago anteriormente', formatMoney(review.previousPaid))}
        {row('Saldo registrado antes desta operação', formatMoney(review.balanceBefore))}
        {row(
          'Valor lido no comprovante',
          review.paidAmount ? formatMoney(review.paidAmount) : 'Não identificado',
          fields.paidAmount,
        )}
        {row(
          'Valor nominal lido',
          fields.nominalAmount?.value ? formatMoney(fields.nominalAmount.value) : undefined,
          fields.nominalAmount,
        )}
        {row(
          'Valor devido indicado no comprovante',
          fields.dueAmount?.value ? formatMoney(fields.dueAmount.value) : undefined,
          fields.dueAmount,
        )}
        {row(
          'Desconto',
          fields.discount?.value ? formatMoney(fields.discount.value) : undefined,
          fields.discount,
        )}
        {row(
          'Juros',
          fields.interest?.value ? formatMoney(fields.interest.value) : undefined,
          fields.interest,
        )}
        {row(
          'Multa',
          fields.penalty?.value ? formatMoney(fields.penalty.value) : undefined,
          fields.penalty,
        )}
        {row(
          'Valor esperado pelo documento',
          review.expectedAmount ? formatMoney(review.expectedAmount) : undefined,
        )}
        {row(
          'Diferença entre pago e valor calculado do documento',
          review.difference ? formatMoney(review.difference) : undefined,
        )}
        {row(
          'Diferença entre valor devido e cálculo do documento',
          review.dueAmountDifference ? formatMoney(review.dueAmountDifference) : undefined,
        )}
        {row(
          'Diferença entre cobrança e saldo do Lívio',
          review.ledgerDifference ? formatMoney(review.ledgerDifference) : undefined,
        )}
        {row(
          'Saldo previsto após aplicação',
          review.balanceAfter ? formatMoney(review.balanceAfter) : undefined,
        )}
        {row('Vencimento cadastrado no Lívio', displayDate(review.dueDate))}
        {row('Pagamento identificado', displayDate(review.paidDate), fields.paidDate)}
        {row(
          'Vencimento indicado no comprovante',
          displayDate(fields.dueDate?.value),
          fields.dueDate,
        )}
        {row('Pagador', fields.payer?.value, fields.payer)}
        {row('Beneficiário', fields.beneficiary?.value, fields.beneficiary)}
      </dl>
      <p>
        A origem indica como o dado foi obtido; não representa uma taxa de precisão. Confira os
        valores antes de confirmar.
      </p>
      <p>
        Leitura automática: {outcomeLabels[review.outcome] ?? review.outcome}.
        {review.flags?.length
          ? ` ${review.flags.map((flag) => flagLabels[flag] ?? flag).join(' · ')}.`
          : ''}{' '}
        O comprovante não confirma a liquidação bancária.
      </p>
      {review.warnings?.length > 0 && (
        <div role="alert" className="notice notice-error">
          {review.warnings.join(' ')}
        </div>
      )}
      <button type="button" className="secondary" onClick={() => void open()}>
        Abrir comprovante privado
      </button>
      {canReview && needsReview && (
        <form className="form-grid" onSubmit={confirm}>
          <label>
            Valor conferido
            <input
              name="amount"
              inputMode="decimal"
              required
              defaultValue={review.paidAmount ?? ''}
            />
          </label>
          <label>
            Data e hora conferidas
            <input
              name="paidAt"
              type="datetime-local"
              required
              defaultValue={review.paidDate ? `${review.paidDate}T12:00` : ''}
            />
          </label>
          <label>
            Forma de pagamento
            <input name="method" required defaultValue={fields.documentType?.value ?? 'PIX'} />
          </label>
          <label>
            Referência
            <input
              name="reference"
              required
              maxLength={100}
              defaultValue={fields.endToEndId?.value ?? `COMPROVANTE-${current.id.slice(0, 8)}`}
            />
          </label>
          <label className="form-wide">
            Motivo de correção, se o valor ou a data diferirem da leitura
            <input name="correctionReason" minLength={5} maxLength={500} />
          </label>
          <p className="form-wide">
            Confira o arquivo e os dados antes de registrar. Valores excedentes exigem decisão
            separada.
          </p>
          <button className="primary" disabled={busy}>
            Confirmar pagamento
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void decide('NEEDS_CORRECTION')}
          >
            Solicitar correção
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void decide('REJECTED')}
          >
            Rejeitar
          </button>
        </form>
      )}
      {feedback && (
        <p
          role="status"
          className={feedback.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
        >
          {feedback}
        </p>
      )}
    </section>
  );
}

export function ReceiptCapture({
  installmentId,
  expenseId,
  canReview = false,
  onChanged,
}: {
  installmentId?: string;
  expenseId?: string;
  canReview?: boolean;
  onChanged?: () => void;
}) {
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setFeedback('Verificando segurança e lendo o comprovante…');
    try {
      if (installmentId) form.set('installmentId', installmentId);
      if (expenseId) form.set('expenseId', expenseId);
      const result = await api<Receipt>('/finance/receipts', { method: 'POST', body: form });
      setReceipt(result);
      setFeedback(
        canReview
          ? 'Leitura concluída. Revise antes de confirmar.'
          : 'Comprovante enviado. O financeiro fará a conferência.',
      );
      onChanged?.();
    } catch (error) {
      setFeedback(`Erro: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-form">
      <form onSubmit={upload} className="stack-form">
        <label>
          Anexar comprovante e identificar pagamento
          <input
            name="file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
            disabled={busy || !(installmentId || expenseId)}
          />
        </label>
        <button className="secondary" disabled={busy || !(installmentId || expenseId)}>
          {busy ? 'Lendo comprovante…' : 'Enviar e conferir comprovante'}
        </button>
      </form>
      {feedback && (
        <p
          role="status"
          className={feedback.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
        >
          {feedback}
        </p>
      )}
      {receipt && <ReceiptReview receipt={receipt} canReview={canReview} onChanged={onChanged} />}
    </div>
  );
}

export function ReceiptReviewQueue({ onChanged }: { onChanged?: () => void }) {
  const receipts = usePaginatedData<Receipt>('/finance/receipts?status=PENDING_REVIEW');
  return (
    <section className="stack-form" aria-label="Comprovantes aguardando conferência">
      <h2>Comprovantes enviados por clientes</h2>
      {receipts.loading && !receipts.data && <p role="status">Carregando comprovantes…</p>}
      {receipts.error && (
        <div role="alert" className="notice notice-error">
          {receipts.error.message}
          <button type="button" onClick={receipts.reload}>
            Tentar novamente
          </button>
        </div>
      )}
      {receipts.data?.items.map((receipt) => (
        <ReceiptReview
          key={receipt.id}
          receipt={receipt}
          canReview
          onChanged={() => {
            receipts.reload();
            onChanged?.();
          }}
        />
      ))}
      {receipts.data && !receipts.data.items.length && <p>Nenhum comprovante pendente.</p>}
      {receipts.data && (
        <LoadMore
          shown={receipts.data.items.length}
          total={receipts.data.total}
          loading={receipts.loading}
          error={receipts.error}
          onLoad={receipts.loadMore}
          onRetry={receipts.retry}
        />
      )}
    </section>
  );
}
