import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { pageResult, pageWindow } from '../common/schemas';
import { DocumentsService } from '../documents/documents.service';
import { DocumentScannerService } from '../documents/document-scanner.service';
import { StorageService } from '../documents/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { ReceiptExtractionService } from './receipt-extraction.service';
import { reconcileReceipt, type ReceiptFields } from './receipt-interpretation';
import type {
  ReceiptConfirmationInput,
  ReceiptDecisionInput,
  ReceiptUploadInput,
} from './receipt.schemas';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateInZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

@Injectable()
export class ReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly documents: DocumentsService,
    private readonly scanner: DocumentScannerService,
    private readonly extraction: ReceiptExtractionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async submit(actor: AuthenticatedActor, input: ReceiptUploadInput, file: Express.Multer.File) {
    this.documents.validateFile(file);
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype))
      throw new UnprocessableEntityException('Comprovante deve ser PDF, JPG ou PNG.');
    if (file.size > 4 * 1024 * 1024) throw new BadRequestException('Comprovante excede 4 MiB.');
    if (input.expenseId && actor.clientId)
      throw new ForbiddenException(
        'O portal só aceita comprovantes de cobranças do próprio cliente.',
      );
    if (input.installmentId && !actor.permissions.includes('receivables:view'))
      throw new ForbiddenException('Sem acesso à cobrança vinculada.');
    if (input.expenseId && !actor.permissions.includes('expenses:view'))
      throw new ForbiddenException('Sem acesso à despesa vinculada.');

    const target = input.installmentId
      ? await this.finance.installmentReceiptBalance(actor, input.installmentId)
      : await this.expenseBalance(actor, input.expenseId!);
    if (target.status === 'CANCELLED' || target.status === 'RENEGOTIATED')
      throw new ConflictException('O lançamento não recebe comprovantes.');
    if (new Prisma.Decimal(target.balance).lessThanOrEqualTo(0))
      throw new ConflictException('O lançamento já está quitado.');
    if (input.expenseId && target.status !== 'APPROVED')
      throw new ConflictException(
        'A despesa precisa estar aprovada para receber comprovante de pagamento.',
      );
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.paymentReceipt.findUnique({
      where: { organizationId_sha256: { organizationId: actor.organizationId, sha256 } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Este comprovante já foi enviado nesta organização.');

    // Security validation precedes OCR and any persistent object. DocumentsService checks again before storage.
    try {
      await this.scanner.assertClean(file.buffer, file.mimetype);
    } catch (error) {
      await this.prisma.$transaction((transaction) =>
        this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'payment_receipt_upload',
          after: { outcome: 'blocked', mimeType: file.mimetype, sizeBytes: file.size },
        }),
      );
      throw error;
    }
    const interpreted = await this.extraction.extract(file.buffer, file.mimetype);
    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { timezone: true },
    });
    if (!organization) throw new NotFoundException('Organização não encontrada.');
    const reconciliation = reconcileReceipt({
      originalAmount: target.originalAmount,
      previousPaid: target.previousPaid,
      balance: target.balance,
      dueDate: target.dueDate,
      fields: interpreted.fields,
      today: dateInZone(new Date(), organization.timezone),
    });
    const document = await this.documents.create(
      actor,
      {
        title: `Comprovante financeiro · ${file.originalname}`.slice(0, 240),
        category: 'PAYMENT_RECEIPT',
        visibility: actor.clientId ? 'CLIENT' : 'INTERNAL',
        clientId: target.clientId,
        ...(input.installmentId
          ? { installmentId: input.installmentId }
          : { expenseId: input.expenseId }),
      },
      file,
    );
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.paymentReceipt.create({
          data: {
            organizationId: actor.organizationId,
            clientId: target.clientId,
            documentId: document.id,
            installmentId: input.installmentId,
            expenseId: input.expenseId,
            sha256,
            submittedById: actor.userId,
            submittedByClient: Boolean(actor.clientId),
            extractedFields: json(interpreted.fields),
            reconciliation: json({
              ...reconciliation,
              method: interpreted.method,
              warnings: [...interpreted.warnings, ...reconciliation.warnings],
            }),
          },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'payment_receipt',
          resourceId: receipt.id,
          after: { status: receipt.status, documentId: receipt.documentId, sha256, target: input },
        });
        return receipt;
      });
    } catch (error) {
      // A competing upload may win the unique hash constraint. Keep the orphaned document inaccessible.
      await this.prisma.document.updateMany({
        where: { id: document.id, organizationId: actor.organizationId },
        data: { deletedAt: new Date() },
      });
      const version = await this.prisma.documentVersion.findFirst({
        where: { documentId: document.id },
        select: { storageKey: true },
      });
      if (version) await this.storage.remove(version.storageKey);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Este comprovante já foi enviado nesta organização.');
      throw error;
    }
  }

  private async expenseBalance(actor: AuthenticatedActor, expenseId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId: actor.organizationId },
      select: { clientId: true, amount: true, dueDate: true, incurredAt: true, status: true },
    });
    if (!expense || !expense.clientId)
      throw new NotFoundException('Despesa com cliente vinculado não encontrada.');
    return {
      clientId: expense.clientId,
      originalAmount: expense.amount.toFixed(2),
      previousPaid: expense.status === 'PAID' ? expense.amount.toFixed(2) : '0.00',
      balance: expense.status === 'PAID' ? '0.00' : expense.amount.toFixed(2),
      dueDate: (expense.dueDate ?? expense.incurredAt).toISOString().slice(0, 10),
      status: expense.status,
    };
  }

  async get(actor: AuthenticatedActor, id: string) {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      include: { document: { select: { id: true, title: true } } },
    });
    if (!receipt) throw new NotFoundException('Comprovante não encontrado.');
    return receipt;
  }

  async list(
    actor: AuthenticatedActor,
    query: {
      page: number;
      pageSize: number;
      status?: string;
      installmentId?: string;
      expenseId?: string;
      clientId?: string;
    },
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(actor.clientId
        ? { clientId: actor.clientId }
        : query.clientId
          ? { clientId: query.clientId }
          : {}),
      ...(query.installmentId ? { installmentId: query.installmentId } : {}),
      ...(query.expenseId ? { expenseId: query.expenseId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentReceipt.findMany({
        where,
        ...pageWindow(query),
        orderBy: { createdAt: 'desc' },
        include: { document: { select: { id: true, title: true } } },
      }),
      this.prisma.paymentReceipt.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async decide(actor: AuthenticatedActor, id: string, input: ReceiptDecisionInput) {
    if (actor.clientId)
      throw new ForbiddenException('Somente a equipe financeira pode revisar comprovantes.');
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.paymentReceipt.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!current) throw new NotFoundException('Comprovante não encontrado.');
      const changed = await transaction.paymentReceipt.updateMany({
        where: { id, organizationId: actor.organizationId, status: 'PENDING_REVIEW' },
        data: {
          status: input.decision,
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          reviewHistory: json([
            ...(Array.isArray(current.reviewHistory) ? current.reviewHistory : []),
            {
              decision: input.decision,
              reason: input.reason,
              actorUserId: actor.userId,
              at: new Date().toISOString(),
            },
          ]),
        },
      });
      if (changed.count !== 1) throw new ConflictException('O comprovante já foi revisado.');
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'payment_receipt',
        resourceId: id,
        before: { status: current.status },
        after: { status: input.decision, reason: input.reason },
      });
      return transaction.paymentReceipt.findUniqueOrThrow({ where: { id } });
    });
  }

  async confirm(actor: AuthenticatedActor, id: string, input: ReceiptConfirmationInput) {
    if (actor.clientId) throw new ForbiddenException('O cliente não pode confirmar pagamento.');
    const receipt = await this.get(actor, id);
    if (receipt.installmentId && !actor.permissions.includes('payments:create'))
      throw new ForbiddenException('Sem permissão para registrar pagamentos.');
    if (receipt.expenseId && !actor.permissions.includes('expenses:update'))
      throw new ForbiddenException('Sem permissão para pagar despesas.');
    if (receipt.status === 'CONFIRMED') {
      const history = Array.isArray(receipt.reviewHistory) ? receipt.reviewHistory : [];
      const confirmation = history.at(-1) as
        { confirmed?: { amount?: string; paidAt?: string } } | undefined;
      if (
        confirmation?.confirmed?.amount === new Prisma.Decimal(input.amount).toFixed(4) &&
        confirmation.confirmed.paidAt === new Date(input.paidAt).toISOString()
      ) {
        if (receipt.paymentId)
          return this.prisma.payment.findFirst({
            where: { id: receipt.paymentId, organizationId: actor.organizationId },
          });
        if (receipt.expenseId)
          return this.prisma.expense.findFirst({
            where: { id: receipt.expenseId, organizationId: actor.organizationId },
          });
      }
      throw new ConflictException('Comprovante já revisado com outros dados.');
    }
    if (receipt.status !== 'PENDING_REVIEW')
      throw new ConflictException('Comprovante já revisado.');
    const fields = receipt.extractedFields as ReceiptFields;
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isPositive()) throw new BadRequestException('Valor deve ser positivo.');
    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { timezone: true },
    });
    if (!organization) throw new NotFoundException('Organização não encontrada.');
    const paidDate = dateInZone(new Date(input.paidAt), organization.timezone);
    const comparison = receipt.reconciliation as {
      difference?: string | null;
      warnings?: string[];
    };
    const discrepancy = Boolean(
      comparison.difference && !new Prisma.Decimal(comparison.difference).isZero(),
    );
    const mismatch =
      !fields.paidAmount ||
      !fields.paidDate ||
      !amount.equals(fields.paidAmount.value) ||
      paidDate !== fields.paidDate.value ||
      discrepancy ||
      Boolean(comparison.warnings?.some((warning) => warning.includes('vencimento')));
    if (mismatch && !input.correctionReason)
      throw new BadRequestException('Informe o motivo da correção dos dados extraídos.');
    if (new Date(input.paidAt).getTime() > Date.now())
      throw new BadRequestException('Pagamento no futuro exige revisão; não pode ser confirmado.');

    if (receipt.installmentId) {
      if (!actor.permissions.includes('payments:create'))
        throw new ForbiddenException('Sem permissão para registrar pagamentos.');
      const current = await this.finance.installmentReceiptBalance(actor, receipt.installmentId);
      if (amount.greaterThan(current.balance))
        throw new BadRequestException(
          'Valor excede o saldo. Decida crédito ou devolução antes de registrar.',
        );
      try {
        return await this.finance.createPayment(
          actor,
          `receipt:${id}`,
          {
            clientId: receipt.clientId,
            reference: input.reference,
            amount: amount.toFixed(4),
            currency: 'BRL',
            paidAt: new Date(input.paidAt),
            method: input.method,
            ...(fields.e2eId ? { externalId: fields.e2eId.value } : {}),
            allocations: [{ installmentId: receipt.installmentId, amount: amount.toFixed(4) }],
          },
          { receiptId: id, correctionReason: input.correctionReason },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('Identificador bancário ou pagamento já registrado.');
        throw error;
      }
    }
    if (!receipt.expenseId) throw new ConflictException('Comprovante sem vínculo financeiro.');
    if (!actor.permissions.includes('expenses:update'))
      throw new ForbiddenException('Sem permissão para pagar despesas.');
    return this.finance.payExpense(
      actor,
      receipt.expenseId,
      {
        amount: amount.toFixed(4),
        paidAt: new Date(input.paidAt),
        method: input.method,
        reference: input.reference,
      },
      { receiptId: id, correctionReason: input.correctionReason },
    );
  }
}
