import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, pageWindow } from '../common/schemas';
import { PushNotificationsService } from '../notifications/push-notifications.service';
import type {
  AdjustmentInput,
  CreateContractInput,
  CreateExpenseInput,
  CreatePaymentInput,
  CreateReceivableInput,
  RenegotiationInput,
  ReversalInput,
  PaymentChangeInput,
  PaymentChangeDecisionInput,
} from './finance.schemas';
import { paymentChangeSchema } from './finance.schemas';
import {
  assertExactRenegotiation,
  installmentStatus,
  paymentSummary,
  positiveMoney,
} from './finance-calculations';

type Transaction = Prisma.TransactionClient;

function paymentChangeInput(value: Prisma.JsonValue): PaymentChangeInput {
  const parsed = paymentChangeSchema.safeParse(value);
  if (!parsed.success) throw new ConflictException('Os dados da solicitação estão inválidos');
  return parsed.data;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly pushNotifications?: PushNotificationsService,
  ) {}

  async createContract(actor: AuthenticatedActor, input: CreateContractInput) {
    await this.assertFinancialReferences(actor.organizationId, input.clientId, input.matterId);
    const serviceNames = [
      ...new Set(input.serviceNames.map((name) => name.trim()).filter(Boolean)),
    ];
    return this.prisma.$transaction(async (transaction) => {
      const contract = await transaction.contract.create({
        data: {
          organizationId: actor.organizationId,
          clientId: input.clientId,
          number: input.number,
          title: input.title,
          feeModel: input.feeModel,
          currency: input.currency.toUpperCase(),
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.fixedAmount ? { fixedAmount: this.money(input.fixedAmount) } : {}),
          ...(input.successRate ? { successRate: new Prisma.Decimal(input.successRate) } : {}),
          ...(input.serviceCode ? { serviceCode: input.serviceCode } : {}),
          ...((serviceNames[0] ?? input.serviceName)
            ? { serviceName: serviceNames[0] ?? input.serviceName }
            : {}),
          ...(serviceNames.length ? { terms: { services: serviceNames } } : {}),
          ...(input.startsAt ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'contract',
        resourceId: contract.id,
        after: contract,
      });
      return contract;
    });
  }

  async createReceivable(actor: AuthenticatedActor, input: CreateReceivableInput) {
    await this.assertFinancialReferences(
      actor.organizationId,
      input.clientId,
      input.matterId,
      input.contractId,
    );
    const amount = this.money(input.originalAmount);
    const installmentTotal = input.installments.reduce(
      (total, installment) => total.plus(this.money(installment.amount)),
      new Prisma.Decimal(0),
    );
    if (!amount.equals(installmentTotal))
      throw new BadRequestException('A soma das parcelas deve ser igual ao valor do recebível');
    if (
      new Set(input.installments.map(({ sequence }) => sequence)).size !== input.installments.length
    )
      throw new BadRequestException('Sequências de parcelas duplicadas');
    const dueDate = input.installments.reduce(
      (latest, installment) => (installment.dueDate > latest ? installment.dueDate : latest),
      input.installments[0]!.dueDate,
    );
    return this.prisma.$transaction(async (transaction) => {
      const receivable = await transaction.receivable.create({
        data: {
          organizationId: actor.organizationId,
          clientId: input.clientId,
          reference: input.reference,
          description: input.description,
          status: 'OPEN',
          originalAmount: amount,
          currency: input.currency.toUpperCase(),
          issueDate: input.issueDate,
          dueDate,
          ...(input.competenceDate ? { competenceDate: input.competenceDate } : {}),
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.contractId ? { contractId: input.contractId } : {}),
          installments: {
            create: input.installments.map((installment) => ({
              organizationId: actor.organizationId,
              sequence: installment.sequence,
              amount: this.money(installment.amount),
              currency: input.currency.toUpperCase(),
              dueDate: installment.dueDate,
              ...(installment.competenceDate ? { competenceDate: installment.competenceDate } : {}),
            })),
          },
        },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'receivable',
        resourceId: receivable.id,
        after: receivable,
      });
      return receivable;
    });
  }

  async createPayment(
    actor: AuthenticatedActor,
    idempotencyKey: string,
    input: CreatePaymentInput,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 160)
      throw new BadRequestException('Idempotency-Key é obrigatório e deve ter até 160 caracteres');
    const payloadHash = sha256(JSON.stringify(input));
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          const existing = await transaction.payment.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId: actor.organizationId,
                idempotencyKey,
              },
            },
            include: { allocations: true },
          });
          if (existing) {
            if (existing.idempotencyHash !== payloadHash)
              throw new ConflictException('Chave idempotente já usada com outro conteúdo');
            const allocated = existing.allocations.reduce(
              (total, allocation) => total.plus(allocation.amount),
              new Prisma.Decimal(0),
            );
            return {
              payment: existing,
              unappliedAmount: existing.amount.minus(allocated).toFixed(2),
              idempotent: true,
            };
          }

          const { amount, allocated: allocationTotal } = paymentSummary(
            input.amount,
            input.allocations.map(({ amount: value }) => value),
          );
          const installmentIds = input.allocations.map(({ installmentId }) => installmentId);
          await this.lockInstallments(transaction, actor.organizationId, installmentIds);
          const installments = await transaction.receivableInstallment.findMany({
            where: { id: { in: installmentIds }, organizationId: actor.organizationId },
            include: {
              receivable: true,
              allocations: { where: { reversedAt: null, payment: { status: 'CONFIRMED' } } },
              adjustments: { where: { approvedAt: { not: null } } },
            },
          });
          if (installments.length !== installmentIds.length)
            throw new NotFoundException('Parcela não encontrada');
          const byId = new Map(installments.map((installment) => [installment.id, installment]));
          for (const allocation of input.allocations) {
            const installment = byId.get(allocation.installmentId)!;
            if (
              installment.receivable.clientId !== input.clientId ||
              installment.currency !== input.currency.toUpperCase()
            )
              throw new BadRequestException('Cliente ou moeda incompatível com a parcela');
            if (['CANCELLED', 'RENEGOTIATED'].includes(installment.status))
              throw new BadRequestException('Parcela não aceita pagamentos');
            if (this.money(allocation.amount).greaterThan(this.balanceFromLoaded(installment)))
              throw new BadRequestException('Alocação excede o saldo disponível da parcela');
          }

          const payment = await transaction.payment.create({
            data: {
              organizationId: actor.organizationId,
              clientId: input.clientId,
              reference: input.reference,
              status: 'CONFIRMED',
              amount,
              currency: input.currency.toUpperCase(),
              paidAt: input.paidAt,
              method: input.method,
              idempotencyKey,
              idempotencyHash: payloadHash,
              confirmedById: actor.userId,
              confirmedAt: new Date(),
              ...(input.externalId ? { externalId: input.externalId } : {}),
              allocations: {
                create: input.allocations.map((allocation) => ({
                  organizationId: actor.organizationId,
                  installmentId: allocation.installmentId,
                  amount: this.money(allocation.amount),
                  createdById: actor.userId,
                })),
              },
            },
            include: { allocations: true },
          });
          for (const allocation of input.allocations) {
            const installment = byId.get(allocation.installmentId)!;
            const remaining = this.balanceFromLoaded(installment).minus(
              this.money(allocation.amount),
            );
            await transaction.receivableInstallment.update({
              where: { id: installment.id },
              data: {
                status: this.statusForBalance(remaining, installment.dueDate, true),
                version: { increment: 1 },
              },
            });
          }
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'CREATE',
            resource: 'payment',
            resourceId: payment.id,
            after: payment,
            metadata: { idempotencyKey, unappliedAmount: amount.minus(allocationTotal).toFixed(2) },
          });
          return {
            payment,
            unappliedAmount: amount.minus(allocationTotal).toFixed(2),
            idempotent: false,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
  }

  async reversePayment(actor: AuthenticatedActor, paymentId: string, input: ReversalInput) {
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
          const payment = await transaction.payment.findFirst({
            where: { id: paymentId, organizationId: actor.organizationId },
            include: { allocations: { where: { reversedAt: null } } },
          });
          if (!payment) throw new NotFoundException('Pagamento não encontrado');
          if (payment.status !== 'CONFIRMED')
            throw new ConflictException('Somente pagamento confirmado pode ser estornado');
          await this.lockInstallments(
            transaction,
            actor.organizationId,
            payment.allocations.map(({ installmentId }) => installmentId),
          );
          const changed = await transaction.payment.updateMany({
            where: { id: payment.id, version: payment.version, status: 'CONFIRMED' },
            data: { status: 'REVERSED', reversedAt: new Date(), version: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException('Pagamento alterado por outro usuário');
          await transaction.paymentAllocation.updateMany({
            where: {
              paymentId: payment.id,
              organizationId: actor.organizationId,
              reversedAt: null,
            },
            data: { reversedAt: new Date(), reversedById: actor.userId },
          });
          const reversal = await transaction.paymentReversal.create({
            data: {
              organizationId: actor.organizationId,
              originalPaymentId: payment.id,
              amount: payment.amount,
              reason: input.reason,
              reversedById: actor.userId,
            },
          });
          for (const allocation of payment.allocations)
            await this.refreshInstallmentStatus(
              transaction,
              actor.organizationId,
              allocation.installmentId,
            );
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'REVERSE',
            resource: 'payment',
            resourceId: payment.id,
            before: payment,
            after: reversal,
          });
          return reversal;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
  }

  async requestPaymentChange(
    actor: AuthenticatedActor,
    paymentId: string,
    input: PaymentChangeInput,
  ) {
    const result = await this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
          const payment = await transaction.payment.findFirst({
            where: { id: paymentId, organizationId: actor.organizationId },
            include: { allocations: { where: { reversedAt: null } } },
          });
          if (!payment) throw new NotFoundException('Pagamento não encontrado');
          if (payment.status !== 'CONFIRMED')
            throw new ConflictException('Somente pagamentos confirmados podem ser corrigidos');
          paymentSummary(
            input.amount,
            input.allocations.map(({ amount }) => amount),
          );
          if (!this.paymentChangeDiffers(payment, input))
            throw new BadRequestException('Informe ao menos uma alteração no pagamento');

          const request = await transaction.paymentChangeRequest.create({
            data: {
              organizationId: actor.organizationId,
              paymentId: payment.id,
              createdById: actor.userId,
              proposedData: {
                ...input,
                baseVersion: payment.version,
              } as unknown as Prisma.InputJsonValue,
              reason: input.reason,
            },
          });
          if (actor.isAdministrator) {
            const correctedPayment = await this.applyPaymentChange(
              transaction,
              actor,
              request.id,
              payment,
              input,
            );
            const approved = await transaction.paymentChangeRequest.update({
              where: { id: request.id },
              data: { status: 'APPROVED', reviewedById: actor.userId, reviewedAt: new Date() },
            });
            await this.audit.record(transaction, {
              organizationId: actor.organizationId,
              actorUserId: actor.userId,
              actorSessionId: actor.sessionId,
              action: 'APPROVE',
              resource: 'payment_change_request',
              resourceId: request.id,
              after: { request: approved, replacementPaymentId: correctedPayment.id },
            });
            return {
              request: approved,
              payment: correctedPayment,
              applied: true as const,
              notificationUserIds: [] as string[],
            };
          }

          const admins = await transaction.organizationMember.findMany({
            where: {
              organizationId: actor.organizationId,
              status: 'ACTIVE',
              user: { status: 'ACTIVE', deletedAt: null },
              roles: { some: { role: { key: 'administrator' } } },
            },
            select: { userId: true },
          });
          if (!admins.length)
            throw new ConflictException('Não há Administrador ativo para aprovar alterações');
          for (const admin of admins) {
            const notificationId = this.stableUuid(`${request.id}:${admin.userId}:payment-change`);
            await transaction.notification.upsert({
              where: { id: notificationId },
              create: {
                id: notificationId,
                organizationId: actor.organizationId,
                userId: admin.userId,
                channel: 'IN_APP',
                status: 'SENT',
                title: 'Alteração de pagamento aguardando aprovação',
                body: `${payment.reference} · ${input.reason}`,
                link: 'finance:payment-approvals',
                metadata: {
                  source: 'PAYMENT_CHANGE_REQUEST',
                  requestId: request.id,
                  paymentId: payment.id,
                },
                sentAt: new Date(),
              },
              update: { title: 'Alteração de pagamento aguardando aprovação' },
            });
          }
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'CREATE',
            resource: 'payment_change_request',
            resourceId: request.id,
            after: request,
          });
          return {
            request,
            applied: false as const,
            notificationUserIds: admins.map(({ userId }) => userId),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
    if (result.applied) return { request: result.request, payment: result.payment, applied: true };
    await this.pushNotifications?.notifyUsers(actor.organizationId, result.notificationUserIds, {
      title: 'Alteração de pagamento aguardando aprovação',
      body: 'Entre no Lívio para revisar a solicitação.',
    });
    return { request: result.request, applied: false };
  }

  async listPaymentChangeRequests(actor: AuthenticatedActor) {
    const requests = await this.prisma.paymentChangeRequest.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(actor.isAdministrator ? { status: 'PENDING' } : { createdById: actor.userId }),
      },
      include: {
        payment: { include: { client: { select: { id: true, displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const userIds = [...new Set(requests.map(({ createdById }) => createdById))];
    const users = await this.prisma.user.findMany({
      where: { organizationId: actor.organizationId, id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.fullName]));
    return {
      items: requests.map((request) => ({
        ...request,
        requestedByName: names.get(request.createdById) ?? 'Usuário',
      })),
      total: requests.length,
    };
  }

  async decidePaymentChange(
    actor: AuthenticatedActor,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    input: PaymentChangeDecisionInput = {},
  ) {
    if (!actor.isAdministrator) throw new ForbiddenException('Acesso exclusivo para Administrador');
    const result = await this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM payment_change_requests WHERE id = ${requestId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
          const request = await transaction.paymentChangeRequest.findFirst({
            where: { id: requestId, organizationId: actor.organizationId },
          });
          if (!request) throw new NotFoundException('Solicitação não encontrada');
          if (request.status !== 'PENDING')
            throw new ConflictException('Esta solicitação já foi analisada');
          if (request.createdById === actor.userId)
            throw new ConflictException('Quem solicitou a alteração não pode aprová-la');

          let replacementPayment: unknown;
          if (decision === 'APPROVED') {
            await transaction.$queryRaw`SELECT id FROM payments WHERE id = ${request.paymentId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
            const payment = await transaction.payment.findFirst({
              where: { id: request.paymentId, organizationId: actor.organizationId },
              include: { allocations: { where: { reversedAt: null } } },
            });
            if (!payment) throw new NotFoundException('Pagamento não encontrado');
            if (payment.status !== 'CONFIRMED')
              throw new ConflictException('O pagamento não está mais disponível para correção');
            const proposed = paymentChangeInput(request.proposedData);
            const baseVersion = (request.proposedData as { baseVersion?: unknown }).baseVersion;
            if (baseVersion !== payment.version)
              throw new ConflictException(
                'O pagamento mudou desde a solicitação; peça uma nova correção',
              );
            replacementPayment = await this.applyPaymentChange(
              transaction,
              actor,
              request.id,
              payment,
              proposed,
            );
          }

          const reviewedAt = new Date();
          const reviewed = await transaction.paymentChangeRequest.update({
            where: { id: request.id },
            data: {
              status: decision,
              reviewedById: actor.userId,
              reviewedAt,
              ...(input.note ? { reviewNote: input.note } : {}),
            },
          });
          const notificationId = this.stableUuid(`${request.id}:${request.createdById}:decision`);
          await transaction.notification.upsert({
            where: { id: notificationId },
            create: {
              id: notificationId,
              organizationId: actor.organizationId,
              userId: request.createdById,
              channel: 'IN_APP',
              status: 'SENT',
              title:
                decision === 'APPROVED'
                  ? 'Correção de pagamento aprovada'
                  : 'Correção de pagamento recusada',
              body: input.note ?? 'A solicitação foi analisada pelo Administrador.',
              link: 'finance:payments',
              metadata: {
                source: 'PAYMENT_CHANGE_DECISION',
                requestId: request.id,
                status: decision,
              },
              sentAt: reviewedAt,
            },
            update: {
              title:
                decision === 'APPROVED'
                  ? 'Correção de pagamento aprovada'
                  : 'Correção de pagamento recusada',
              body: input.note ?? 'A solicitação foi analisada pelo Administrador.',
            },
          });
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: decision === 'APPROVED' ? 'APPROVE' : 'UPDATE',
            resource: 'payment_change_request',
            resourceId: request.id,
            before: request,
            after: { request: reviewed, replacementPayment },
          });
          return {
            request: reviewed,
            payment: replacementPayment,
            notificationUserId: request.createdById,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
    await this.pushNotifications?.notifyUsers(actor.organizationId, [result.notificationUserId], {
      title:
        decision === 'APPROVED'
          ? 'Correção de pagamento aprovada'
          : 'Correção de pagamento recusada',
      body: 'Entre no Lívio para consultar a resposta.',
    });
    return { request: result.request, payment: result.payment };
  }

  async addAdjustment(actor: AuthenticatedActor, installmentId: string, input: AdjustmentInput) {
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockInstallments(transaction, actor.organizationId, [installmentId]);
          const installment = await transaction.receivableInstallment.findFirst({
            where: { id: installmentId, organizationId: actor.organizationId },
          });
          const amount = this.money(input.amount);
          const currentBalance = await this.installmentBalance(
            transaction,
            actor.organizationId,
            installmentId,
          );
          if (['DISCOUNT', 'REVERSAL'].includes(input.kind) && amount.greaterThan(currentBalance)) {
            throw new BadRequestException('Ajuste não pode tornar o saldo da parcela negativo');
          }
          if (!installment) throw new NotFoundException('Parcela não encontrada');
          const adjustment = await transaction.financialAdjustment.create({
            data: {
              organizationId: actor.organizationId,
              installmentId,
              kind: input.kind,
              amount,
              reason: input.reason,
              effectiveAt: input.effectiveAt,
              createdById: actor.userId,
              approvedById: actor.userId,
              approvedAt: new Date(),
            },
          });
          await this.refreshInstallmentStatus(transaction, actor.organizationId, installmentId);
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'APPROVE',
            resource: 'financial_adjustment',
            resourceId: adjustment.id,
            after: adjustment,
          });
          return adjustment;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
  }

  async renegotiate(actor: AuthenticatedActor, receivableId: string, input: RenegotiationInput) {
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (transaction) => {
          const original = await transaction.receivable.findFirst({
            where: { id: receivableId, organizationId: actor.organizationId },
            include: { installments: true },
          });
          if (!original) throw new NotFoundException('Recebível não encontrado');
          await this.lockInstallments(
            transaction,
            actor.organizationId,
            original.installments.map(({ id }) => id),
          );
          const balances = await Promise.all(
            original.installments.map((installment) =>
              this.installmentBalance(transaction, actor.organizationId, installment.id),
            ),
          );
          const outstanding = balances.reduce(
            (total, balance) => total.plus(balance),
            new Prisma.Decimal(0),
          );
          const newTotal = assertExactRenegotiation(
            outstanding,
            input.installments.map(({ amount }) => amount),
          );
          const dueDate = input.installments.reduce(
            (latest, installment) => (installment.dueDate > latest ? installment.dueDate : latest),
            input.installments[0]!.dueDate,
          );
          await transaction.receivableInstallment.updateMany({
            where: {
              receivableId,
              organizationId: actor.organizationId,
              status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            },
            data: {
              status: 'RENEGOTIATED',
              cancelledAt: new Date(),
              cancellationReason: input.reason,
              version: { increment: 1 },
            },
          });
          await transaction.receivable.update({
            where: { id: receivableId },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
          });
          const resulting = await transaction.receivable.create({
            data: {
              organizationId: actor.organizationId,
              clientId: original.clientId,
              matterId: original.matterId,
              contractId: original.contractId,
              reference: input.reference,
              description: input.description,
              status: 'OPEN',
              originalAmount: newTotal,
              currency: original.currency,
              issueDate: input.issueDate,
              dueDate,
              ...(input.competenceDate ? { competenceDate: input.competenceDate } : {}),
              installments: {
                create: input.installments.map((installment) => ({
                  organizationId: actor.organizationId,
                  sequence: installment.sequence,
                  amount: this.money(installment.amount),
                  currency: original.currency,
                  dueDate: installment.dueDate,
                  ...(installment.competenceDate
                    ? { competenceDate: installment.competenceDate }
                    : {}),
                })),
              },
            },
            include: { installments: true },
          });
          const renegotiation = await transaction.renegotiation.create({
            data: {
              organizationId: actor.organizationId,
              originalReceivableId: original.id,
              resultingReceivableId: resulting.id,
              status: 'APPROVED',
              reason: input.reason,
              createdById: actor.userId,
              approvedById: actor.userId,
              approvedAt: new Date(),
            },
          });
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'APPROVE',
            resource: 'renegotiation',
            resourceId: renegotiation.id,
            before: { original, balances: balances.map((balance) => balance.toFixed(2)) },
            after: resulting,
          });
          return { renegotiation, resultingReceivable: resulting };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
  }

  async createExpense(actor: AuthenticatedActor, input: CreateExpenseInput) {
    if (input.clientId) await this.assertClient(actor.organizationId, input.clientId);
    if (
      input.matterId &&
      !(await this.prisma.matter.findFirst({
        where: { id: input.matterId, organizationId: actor.organizationId, deletedAt: null },
      }))
    ) {
      throw new NotFoundException('Processo não encontrado');
    }
    return this.prisma.$transaction(async (transaction) => {
      const expense = await transaction.expense.create({
        data: {
          organizationId: actor.organizationId,
          description: input.description,
          category: input.category,
          amount: this.money(input.amount),
          currency: input.currency.toUpperCase(),
          incurredAt: input.incurredAt,
          reimbursable: input.reimbursable,
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'expense',
        resourceId: expense.id,
        after: expense,
      });
      return expense;
    });
  }

  async getReceivable(actor: AuthenticatedActor, id: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      include: {
        installments: {
          orderBy: { sequence: 'asc' },
          include: {
            allocations: { where: { reversedAt: null }, include: { payment: true } },
            adjustments: true,
          },
        },
        contract: true,
        matter: true,
      },
    });
    if (!receivable) throw new NotFoundException('Recebível não encontrado');
    return receivable;
  }

  async listContracts(
    actor: AuthenticatedActor,
    input: import('./finance.schemas').FinanceListQuery,
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.status ? { status: input.status as Prisma.ContractWhereInput['status'] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        ...pageWindow(input),
        include: {
          client: { select: { id: true, displayName: true } },
          matter: { select: { id: true, reference: true } },
          _count: { select: { receivables: true, documents: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async listReceivables(
    actor: AuthenticatedActor,
    input: import('./finance.schemas').FinanceListQuery,
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.contractId ? { contractId: input.contractId } : {}),
      ...(input.status ? { status: input.status as Prisma.ReceivableWhereInput['status'] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.receivable.findMany({
        where,
        ...pageWindow(input),
        include: {
          client: { select: { id: true, displayName: true } },
          contract: { select: { id: true, number: true } },
          installments: {
            orderBy: { sequence: 'asc' },
            include: {
              allocations: {
                where: { reversedAt: null, payment: { status: 'CONFIRMED' } },
                select: { amount: true },
              },
              adjustments: {
                where: { approvedAt: { not: null } },
                select: { kind: true, amount: true },
              },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.receivable.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async listPayments(
    actor: AuthenticatedActor,
    input: import('./finance.schemas').FinanceListQuery,
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.status ? { status: input.status as Prisma.PaymentWhereInput['status'] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        ...pageWindow(input),
        include: {
          client: { select: { id: true, displayName: true } },
          allocations: {
            where: { reversedAt: null },
            include: {
              installment: {
                select: { id: true, sequence: true, receivable: { select: { reference: true } } },
              },
            },
          },
          documents: { select: { id: true, title: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async listExpenses(
    actor: AuthenticatedActor,
    input: import('./finance.schemas').FinanceListQuery,
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.status ? { status: input.status as Prisma.ExpenseWhereInput['status'] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        ...pageWindow(input),
        include: {
          client: { select: { id: true, displayName: true } },
          matter: { select: { id: true, reference: true } },
          documents: { select: { id: true, title: true } },
        },
        orderBy: { incurredAt: 'desc' },
      }),
      this.prisma.expense.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  private paymentChangeDiffers(
    payment: Prisma.PaymentGetPayload<{ include: { allocations: true } }>,
    input: PaymentChangeInput,
  ): boolean {
    const externalId = input.externalId === undefined ? payment.externalId : input.externalId;
    const currentAllocations = payment.allocations
      .map(({ installmentId, amount }) => `${installmentId}:${amount.toFixed(4)}`)
      .sort();
    const proposedAllocations = input.allocations
      .map(({ installmentId, amount }) => `${installmentId}:${this.money(amount).toFixed(4)}`)
      .sort();
    return (
      payment.reference !== input.reference ||
      !payment.amount.equals(this.money(input.amount)) ||
      payment.paidAt.getTime() !== input.paidAt.getTime() ||
      payment.method !== input.method ||
      payment.externalId !== externalId ||
      currentAllocations.join('|') !== proposedAllocations.join('|')
    );
  }

  private async applyPaymentChange(
    transaction: Transaction,
    actor: AuthenticatedActor,
    requestId: string,
    payment: Prisma.PaymentGetPayload<{ include: { allocations: true } }>,
    input: PaymentChangeInput,
  ) {
    if (!actor.isAdministrator) throw new ForbiddenException('Acesso exclusivo para Administrador');
    const { amount, allocated } = paymentSummary(
      input.amount,
      input.allocations.map(({ amount: value }) => value),
    );
    const targetIds = input.allocations.map(({ installmentId }) => installmentId);
    const previousIds = payment.allocations.map(({ installmentId }) => installmentId);
    await this.lockInstallments(transaction, actor.organizationId, [
      ...new Set([...targetIds, ...previousIds]),
    ]);

    const reversedAt = new Date();
    const changed = await transaction.payment.updateMany({
      where: {
        id: payment.id,
        organizationId: actor.organizationId,
        version: payment.version,
        status: 'CONFIRMED',
      },
      data: { status: 'REVERSED', reversedAt, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ConflictException('Pagamento alterado por outro usuário');
    await transaction.paymentAllocation.updateMany({
      where: { paymentId: payment.id, organizationId: actor.organizationId, reversedAt: null },
      data: { reversedAt, reversedById: actor.userId },
    });
    const reversal = await transaction.paymentReversal.create({
      data: {
        organizationId: actor.organizationId,
        originalPaymentId: payment.id,
        amount: payment.amount,
        reason: `Correção aprovada: ${input.reason}`,
        reversedById: actor.userId,
      },
    });
    for (const installmentId of previousIds)
      await this.refreshInstallmentStatus(transaction, actor.organizationId, installmentId);

    const replacementPaymentId = randomUUID();
    const archivedReference = `${payment.reference.slice(0, 87)}-EST-${requestId.slice(0, 8)}`;
    const priorMetadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? (payment.metadata as Record<string, Prisma.JsonValue>)
        : {};
    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        reference: archivedReference,
        metadata: {
          ...priorMetadata,
          correctionRequestId: requestId,
          replacementPaymentId,
          replacedExternalId: payment.externalId,
        } as Prisma.InputJsonValue,
        externalId: null,
      },
    });

    const installments = targetIds.length
      ? await transaction.receivableInstallment.findMany({
          where: { id: { in: targetIds }, organizationId: actor.organizationId },
          include: {
            receivable: true,
            allocations: { where: { reversedAt: null, payment: { status: 'CONFIRMED' } } },
            adjustments: { where: { approvedAt: { not: null } } },
          },
        })
      : [];
    if (installments.length !== targetIds.length)
      throw new NotFoundException('Uma das parcelas não foi encontrada');
    const installmentById = new Map(
      installments.map((installment) => [installment.id, installment]),
    );
    for (const allocation of input.allocations) {
      const installment = installmentById.get(allocation.installmentId)!;
      if (
        installment.receivable.clientId !== payment.clientId ||
        installment.currency !== payment.currency
      )
        throw new BadRequestException('Cliente ou moeda incompatível com a parcela corrigida');
      if (['CANCELLED', 'RENEGOTIATED'].includes(installment.status))
        throw new BadRequestException('Parcela não aceita pagamentos');
      if (this.money(allocation.amount).greaterThan(this.balanceFromLoaded(installment)))
        throw new BadRequestException('Alocação excede o saldo disponível da parcela');
    }

    const corrected = await transaction.payment.create({
      data: {
        id: replacementPaymentId,
        organizationId: actor.organizationId,
        clientId: payment.clientId,
        reference: input.reference,
        status: 'CONFIRMED',
        amount,
        currency: payment.currency,
        paidAt: input.paidAt,
        method: input.method,
        externalId: input.externalId === undefined ? payment.externalId : input.externalId,
        idempotencyKey: `change-${requestId}`,
        idempotencyHash: sha256(JSON.stringify({ ...input, requestId })),
        confirmedById: actor.userId,
        confirmedAt: new Date(),
        metadata: { source: 'PAYMENT_CHANGE_REQUEST', requestId, originalPaymentId: payment.id },
        allocations: {
          create: input.allocations.map((allocation) => ({
            organizationId: actor.organizationId,
            installmentId: allocation.installmentId,
            amount: this.money(allocation.amount),
            createdById: actor.userId,
          })),
        },
      },
      include: { allocations: true },
    });
    for (const allocation of input.allocations) {
      const installment = installmentById.get(allocation.installmentId)!;
      const remaining = this.balanceFromLoaded(installment).minus(this.money(allocation.amount));
      await transaction.receivableInstallment.update({
        where: { id: installment.id },
        data: {
          status: this.statusForBalance(remaining, installment.dueDate, true),
          version: { increment: 1 },
        },
      });
    }
    await this.audit.record(transaction, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      action: 'REVERSE',
      resource: 'payment',
      resourceId: payment.id,
      before: payment,
      after: reversal,
      metadata: { correctionRequestId: requestId, replacementPaymentId },
    });
    await this.audit.record(transaction, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      action: 'CREATE',
      resource: 'payment',
      resourceId: corrected.id,
      after: corrected,
      metadata: {
        correctionRequestId: requestId,
        originalPaymentId: payment.id,
        unappliedAmount: amount.minus(allocated).toFixed(2),
      },
    });
    return corrected;
  }

  private stableUuid(value: string): string {
    const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private money(value: string | Prisma.Decimal): Prisma.Decimal {
    return positiveMoney(value);
  }

  private async assertClient(organizationId: string, clientId: string): Promise<void> {
    if (
      !(await this.prisma.client.findFirst({
        where: { id: clientId, organizationId, deletedAt: null },
      }))
    )
      throw new NotFoundException('Cliente não encontrado');
  }

  private async assertFinancialReferences(
    organizationId: string,
    clientId: string,
    matterId?: string,
    contractId?: string,
  ): Promise<void> {
    await this.assertClient(organizationId, clientId);
    const [matter, contract] = await Promise.all([
      matterId
        ? this.prisma.matter.findFirst({
            where: { id: matterId, organizationId, clientId, deletedAt: null },
            select: { id: true },
          })
        : { id: 'not-required' },
      contractId
        ? this.prisma.contract.findFirst({
            where: { id: contractId, organizationId, clientId },
            select: { id: true, matterId: true },
          })
        : { id: 'not-required', matterId: null },
    ]);
    if (!matter) throw new NotFoundException('Processo não pertence ao cliente');
    if (!contract) throw new NotFoundException('Contrato não pertence ao cliente');
    if (matterId && contractId && contract.matterId && contract.matterId !== matterId) {
      throw new BadRequestException('Contrato não pertence ao processo informado');
    }
  }

  private balanceFromLoaded(installment: {
    amount: Prisma.Decimal;
    allocations: { amount: Prisma.Decimal }[];
    adjustments: { amount: Prisma.Decimal; kind: string }[];
  }): Prisma.Decimal {
    const adjusted = installment.adjustments.reduce(
      (total, adjustment) =>
        ['DISCOUNT', 'REVERSAL'].includes(adjustment.kind)
          ? total.minus(adjustment.amount)
          : total.plus(adjustment.amount),
      installment.amount,
    );
    return adjusted.minus(
      installment.allocations.reduce(
        (total, allocation) => total.plus(allocation.amount),
        new Prisma.Decimal(0),
      ),
    );
  }

  private async installmentBalance(
    transaction: Transaction,
    organizationId: string,
    installmentId: string,
  ): Promise<Prisma.Decimal> {
    const installment = await transaction.receivableInstallment.findFirst({
      where: { id: installmentId, organizationId },
      include: {
        allocations: { where: { reversedAt: null, payment: { status: 'CONFIRMED' } } },
        adjustments: { where: { approvedAt: { not: null } } },
      },
    });
    if (!installment) throw new NotFoundException('Parcela não encontrada');
    return this.balanceFromLoaded(installment);
  }

  private async refreshInstallmentStatus(
    transaction: Transaction,
    organizationId: string,
    installmentId: string,
  ): Promise<void> {
    const installment = await transaction.receivableInstallment.findFirst({
      where: { id: installmentId, organizationId },
    });
    if (!installment || ['CANCELLED', 'RENEGOTIATED'].includes(installment.status)) return;
    const balance = await this.installmentBalance(transaction, organizationId, installmentId);
    const activeAllocations = await transaction.paymentAllocation.count({
      where: { installmentId, organizationId, reversedAt: null, payment: { status: 'CONFIRMED' } },
    });
    await transaction.receivableInstallment.update({
      where: { id: installmentId },
      data: {
        status: this.statusForBalance(balance, installment.dueDate, activeAllocations > 0),
        version: { increment: 1 },
      },
    });
  }

  private statusForBalance(
    balance: Prisma.Decimal,
    dueDate: Date,
    hasPayments: boolean,
  ): 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'OPEN' {
    return installmentStatus(balance, dueDate, hasPayments);
  }

  private async lockInstallments(
    transaction: Transaction,
    organizationId: string,
    ids: string[],
  ): Promise<void> {
    if (!ids.length) return;
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM receivable_installments WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
    );
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < 4
      )
        return this.withSerializableRetry(operation, attempt + 1);
      throw error;
    }
  }
}
