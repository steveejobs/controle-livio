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
import { scheduleHearingReminders } from '../notifications/hearing-reminders';
import type {
  AdjustmentInput,
  CreateContractInput,
  CreateExpenseInput,
  ExpenseHistoryQuery,
  ExpenseListQuery,
  ExpensePaymentInput,
  ExpenseSummaryQuery,
  CreatePaymentInput,
  CreateReceivableInput,
  RenegotiationInput,
  ReversalInput,
  UpdateExpenseInput,
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

  private expenseTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation, { maxWait: 10_000, timeout: 15_000 });
  }

  async createContract(actor: AuthenticatedActor, input: CreateContractInput) {
    await this.assertFinancialReferences(actor.organizationId, input.clientId, input.matterId);
    const serviceNames = [
      ...new Set(input.serviceNames.map((name) => name.trim()).filter(Boolean)),
    ];
    return this.prisma.$transaction(async (transaction) => {
      if (input.receivableId) {
        await transaction.$queryRaw`SELECT id FROM receivables WHERE id = ${input.receivableId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
      }
      const receivable = input.receivableId
        ? await transaction.receivable.findFirst({
            where: {
              id: input.receivableId,
              organizationId: actor.organizationId,
              clientId: input.clientId,
            },
            select: {
              id: true,
              contractId: true,
              matterId: true,
              originalAmount: true,
              currency: true,
              status: true,
            },
          })
        : null;
      if (input.receivableId && !receivable)
        throw new NotFoundException('Cobrança não encontrada para este cliente');
      if (receivable?.status === 'CANCELLED')
        throw new BadRequestException('Não é possível vincular uma cobrança cancelada');
      if (receivable?.contractId)
        throw new BadRequestException('Esta cobrança já está vinculada a outro contrato');
      if (input.matterId && receivable?.matterId && input.matterId !== receivable.matterId)
        throw new BadRequestException('A cobrança pertence a outro processo');
      if (
        receivable &&
        input.fixedAmount &&
        input.feeModel !== 'HOURLY' &&
        !this.money(input.fixedAmount).equals(receivable.originalAmount)
      ) {
        throw new BadRequestException(
          'O valor da cobrança vinculada deve ser igual ao valor fixo do contrato',
        );
      }
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
      for (const hearing of input.hearings ?? []) {
        if (hearing.startsAt <= new Date())
          throw new BadRequestException('A data e o horário da audiência devem estar no futuro');
        const endsAt = hearing.endsAt ?? new Date(hearing.startsAt.getTime() + 60 * 60_000);
        const event = await transaction.calendarEvent.create({
          data: {
            organizationId: actor.organizationId,
            clientId: input.clientId,
            ...(input.matterId ? { matterId: input.matterId } : {}),
            title: `Audiência · ${input.title}`,
            description: `Contrato ${input.number}${serviceNames.length ? ` · ${serviceNames.join(', ')}` : ''}`,
            location: hearing.location || null,
            type: 'HEARING',
            status: 'SCHEDULED',
            startsAt: hearing.startsAt,
            endsAt,
            timezone: 'America/Sao_Paulo',
            allDay: false,
            attendees: [],
            ...(hearing.reminderMinutes ? { reminderMinutes: hearing.reminderMinutes } : {}),
            createdById: actor.userId,
          },
        });
        await scheduleHearingReminders(transaction, {
          organizationId: actor.organizationId,
          userId: actor.userId,
          eventId: event.id,
          eventTitle: event.title,
          startsAt: event.startsAt,
          reminderMinutes: hearing.reminderMinutes,
          clientId: input.clientId,
          contractId: contract.id,
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'calendar_event',
          resourceId: event.id,
          after: event,
        });
      }
      if (receivable) {
        const linked = await transaction.receivable.update({
          where: { id: receivable.id },
          data: { contractId: contract.id },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'UPDATE',
          resource: 'receivable',
          resourceId: receivable.id,
          before: { contractId: null },
          after: { contractId: contract.id, reference: linked.reference },
        });
      }
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
          const affectedReceivableIds = new Set(
            input.allocations.map(({ installmentId }) => byId.get(installmentId)!.receivable.id),
          );
          for (const receivableId of affectedReceivableIds)
            await this.refreshReceivableStatus(transaction, actor.organizationId, receivableId);
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
    return this.expenseTransaction(async (transaction) => {
      const linkedClientId = await this.assertExpenseLinks(
        transaction,
        actor.organizationId,
        input.clientId,
        input.matterId,
        input.responsibleUserId,
      );
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
          ...(linkedClientId ? { clientId: linkedClientId } : {}),
          ...(input.responsibleUserId ? { responsibleUserId: input.responsibleUserId } : {}),
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

  async expenseApprovalPolicy(actor: AuthenticatedActor) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: actor.organizationId },
      select: { settings: true },
    });
    if (!organization) throw new NotFoundException('Organização não encontrada');
    const required = this.expenseApprovalRequired(organization.settings);
    return {
      required,
      canSubmitForApproval:
        !required ||
        (await this.hasIndependentExpenseApprover(this.prisma, actor.organizationId, actor.userId)),
    };
  }

  async expenseResponsibles(actor: AuthenticatedActor) {
    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId: actor.organizationId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { user: { select: { id: true, fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return members.map(({ user }) => user);
  }

  async updateExpenseApprovalPolicy(actor: AuthenticatedActor, required: boolean) {
    if (!actor.isAdministrator)
      throw new ForbiddenException('Somente Administradores podem alterar esta configuração');
    return this.expenseTransaction(async (transaction) => {
      const organization = await transaction.organization.findFirst({
        where: { id: actor.organizationId },
        select: { settings: true },
      });
      if (!organization) throw new NotFoundException('Organização não encontrada');
      const before = this.expenseApprovalRequired(organization.settings);
      const [updated] = await transaction.$queryRaw<Array<{ settings: Prisma.JsonValue }>>`
        UPDATE organizations
           SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('expenseApprovalRequired', ${required}),
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${actor.organizationId}::uuid
         RETURNING settings`;
      if (!updated) throw new NotFoundException('Organização não encontrada');
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'organization_expense_policy',
        resourceId: actor.organizationId,
        before: { expenseApprovalRequired: before },
        after: { expenseApprovalRequired: required },
      });
      return { required: this.expenseApprovalRequired(updated.settings) };
    });
  }

  async updateExpense(actor: AuthenticatedActor, id: string, input: UpdateExpenseInput) {
    return this.expenseTransaction(async (transaction) => {
      const before = await this.lockExpense(transaction, actor, id);
      if (!['DRAFT', 'REJECTED'].includes(before.status))
        throw new ConflictException(
          'Somente despesas em rascunho ou rejeitadas podem ser alteradas',
        );
      const clientId = input.clientId === undefined ? before.clientId : input.clientId;
      const matterId = input.matterId === undefined ? before.matterId : input.matterId;
      const responsibleUserId =
        input.responsibleUserId === undefined ? before.responsibleUserId : input.responsibleUserId;
      const linkedClientId = await this.assertExpenseLinks(
        transaction,
        actor.organizationId,
        clientId ?? undefined,
        matterId ?? undefined,
        responsibleUserId ?? undefined,
      );
      const changed = await transaction.expense.updateMany({
        where: { id, organizationId: actor.organizationId, status: { in: ['DRAFT', 'REJECTED'] } },
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.amount !== undefined ? { amount: this.money(input.amount) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
          ...(input.incurredAt !== undefined ? { incurredAt: input.incurredAt } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.reimbursable !== undefined ? { reimbursable: input.reimbursable } : {}),
          clientId: linkedClientId,
          matterId,
          responsibleUserId,
          ...(before.status === 'REJECTED'
            ? { status: 'DRAFT', rejectedById: null, rejectedAt: null, rejectionReason: null }
            : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException('A despesa mudou durante a edição');
      const after = await this.findExpense(actor, id, transaction);
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'expense',
        resourceId: id,
        before,
        after,
      });
      return after;
    });
  }

  async submitExpense(actor: AuthenticatedActor, id: string) {
    return this.expenseTransaction(async (transaction) => {
      const before = await this.lockExpense(transaction, actor, id);
      if (!['DRAFT', 'REJECTED'].includes(before.status))
        throw new ConflictException(
          'Somente despesas em rascunho ou rejeitadas podem ser enviadas',
        );
      const organization = await transaction.organization.findFirst({
        where: { id: actor.organizationId },
        select: { settings: true },
      });
      if (!organization) throw new NotFoundException('Organização não encontrada');
      const now = new Date();
      const approvalRequired = this.expenseApprovalRequired(organization.settings);
      if (!before.dueDate)
        throw new BadRequestException('Informe o vencimento antes de confirmar a despesa');
      if (
        approvalRequired &&
        !(await this.hasIndependentExpenseApprover(transaction, actor.organizationId, actor.userId))
      ) {
        throw new ConflictException(
          'Não há outro membro ativo com permissão para aprovar. Desative a aprovação ou habilite outro aprovador antes do envio.',
        );
      }
      const changed = await transaction.expense.updateMany({
        where: { id, organizationId: actor.organizationId, status: { in: ['DRAFT', 'REJECTED'] } },
        data: {
          status: approvalRequired ? 'PENDING_APPROVAL' : 'APPROVED',
          submittedAt: now,
          approvedAt: null,
          approvedById: null,
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      if (changed.count !== 1) throw new ConflictException('A despesa mudou durante o envio');
      const after = await this.findExpense(actor, id, transaction);
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'expense',
        resourceId: id,
        before,
        after,
        metadata: { transition: approvalRequired ? 'SUBMIT' : 'CONFIRM', approvalRequired },
      });
      return after;
    });
  }

  async decideExpense(
    actor: AuthenticatedActor,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('A rejeição exige justificativa');
    return this.expenseTransaction(async (transaction) => {
      const before = await this.lockExpense(transaction, actor, id);
      if (before.status !== 'PENDING_APPROVAL')
        throw new ConflictException('A despesa não aguarda aprovação');
      if (decision === 'APPROVE') {
        const creator = await transaction.auditLog.findFirst({
          where: {
            organizationId: actor.organizationId,
            resource: 'expense',
            resourceId: id,
            action: 'CREATE',
          },
          orderBy: { createdAt: 'asc' },
          select: { actorUserId: true },
        });
        if (creator?.actorUserId === actor.userId)
          throw new ForbiddenException(
            'Quem cadastrou a despesa não pode aprovar a própria solicitação',
          );
      }
      const now = new Date();
      const changed = await transaction.expense.updateMany({
        where: { id, organizationId: actor.organizationId, status: 'PENDING_APPROVAL' },
        data:
          decision === 'APPROVE'
            ? {
                status: 'APPROVED',
                approvedById: actor.userId,
                approvedAt: now,
                rejectedById: null,
                rejectedAt: null,
                rejectionReason: null,
              }
            : {
                status: 'REJECTED',
                approvedById: null,
                approvedAt: null,
                rejectedById: actor.userId,
                rejectedAt: now,
                rejectionReason: reason,
              },
      });
      if (changed.count !== 1)
        throw new ConflictException('A despesa foi decidida por outro usuário');
      const after = await this.findExpense(actor, id, transaction);
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: decision === 'APPROVE' ? 'APPROVE' : 'UPDATE',
        resource: 'expense',
        resourceId: id,
        before,
        after,
        metadata: { transition: decision, ...(reason ? { reason } : {}) },
      });
      return after;
    });
  }

  async payExpense(actor: AuthenticatedActor, id: string, input: ExpensePaymentInput) {
    return this.expenseTransaction(async (transaction) => {
      const before = await this.lockExpense(transaction, actor, id);
      if (before.status !== 'APPROVED')
        throw new ConflictException('Somente despesas aprovadas podem ser pagas');
      const paymentAmount = this.money(input.amount);
      if (!paymentAmount.equals(before.amount))
        throw new BadRequestException(
          'O pagamento deve quitar o valor integral; pagamento parcial não é suportado',
        );
      const changed = await transaction.expense.updateMany({
        where: { id, organizationId: actor.organizationId, status: 'APPROVED' },
        data: { status: 'PAID', paidAt: input.paidAt },
      });
      if (changed.count !== 1) throw new ConflictException('A despesa foi paga por outro usuário');
      const after = await this.findExpense(actor, id, transaction);
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'expense',
        resourceId: id,
        before,
        after,
        metadata: {
          transition: 'PAY',
          amount: paymentAmount.toFixed(4),
          method: input.method,
          reference: input.reference ?? null,
        },
      });
      return after;
    });
  }

  async cancelExpense(actor: AuthenticatedActor, id: string) {
    return this.expenseTransaction(async (transaction) => {
      const before = await this.lockExpense(transaction, actor, id);
      if (before.status === 'PAID')
        throw new ConflictException('Despesas pagas não podem ser canceladas');
      if (before.status === 'CANCELLED') throw new ConflictException('A despesa já está cancelada');
      const changed = await transaction.expense.updateMany({
        where: { id, organizationId: actor.organizationId, status: before.status },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1)
        throw new ConflictException('A despesa mudou durante o cancelamento');
      const after = await this.findExpense(actor, id, transaction);
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CANCEL',
        resource: 'expense',
        resourceId: id,
        before,
        after,
        metadata: { transition: 'CANCEL' },
      });
      return after;
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
      ...(actor.clientId
        ? { clientId: actor.clientId }
        : input.clientId
          ? { clientId: input.clientId }
          : {}),
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
      ...(actor.clientId
        ? { clientId: actor.clientId }
        : input.clientId
          ? { clientId: input.clientId }
          : {}),
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
      ...(actor.clientId
        ? { clientId: actor.clientId }
        : input.clientId
          ? { clientId: input.clientId }
          : {}),
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

  async listExpenses(actor: AuthenticatedActor, input: ExpenseListQuery) {
    const canViewDocuments = actor.permissions.includes('documents:view');
    const where = {
      organizationId: actor.organizationId,
      ...(actor.clientId
        ? { clientId: actor.clientId }
        : input.clientId
          ? { clientId: input.clientId }
          : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.category
        ? { category: { contains: input.category, mode: 'insensitive' as const } }
        : {}),
      ...(input.from || input.to
        ? {
            [input.period]: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        ...pageWindow(input),
        include: {
          client: { select: { id: true, displayName: true } },
          matter: { select: { id: true, reference: true } },
          responsibleUser: { select: { id: true, fullName: true } },
          ...(canViewDocuments
            ? {
                documents: {
                  where: {
                    deletedAt: null,
                    ...(actor.clientId
                      ? { visibility: 'CLIENT' as const, clientId: actor.clientId }
                      : {}),
                  },
                  select: { id: true, title: true, visibility: true },
                },
              }
            : {}),
        },
        orderBy: { [input.period]: 'desc' },
      }),
      this.prisma.expense.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async expenseHistory(actor: AuthenticatedActor, id: string, input: ExpenseHistoryQuery) {
    const expense = await this.prisma.expense.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      select: { id: true },
    });
    if (!expense) throw new NotFoundException('Despesa n\u00e3o encontrada');

    const where = { organizationId: actor.organizationId, resource: 'expense', resourceId: id };
    const [events, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          actorUserId: true,
          action: true,
          before: true,
          after: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const actorIds = [
      ...new Set(events.flatMap(({ actorUserId }) => (actorUserId ? [actorUserId] : []))),
    ];
    const members = actorIds.length
      ? await this.prisma.organizationMember.findMany({
          where: { organizationId: actor.organizationId, userId: { in: actorIds } },
          select: { userId: true, user: { select: { fullName: true } } },
        })
      : [];
    const names = new Map(members.map(({ userId, user }) => [userId, user.fullName]));
    const objectValue = (value: Prisma.JsonValue | null): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      items: events.map((event) => {
        const before = objectValue(event.before);
        const after = objectValue(event.after);
        const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          .sort();
        const metadata = objectValue(event.metadata);
        return {
          id: event.id,
          action: event.action,
          transition: typeof metadata.transition === 'string' ? metadata.transition : undefined,
          occurredAt: event.createdAt,
          actorName: event.actorUserId
            ? (names.get(event.actorUserId) ?? 'Usu\u00e1rio indispon\u00edvel')
            : 'Sistema',
          changedFields,
        };
      }),
      total,
    };
  }

  async expenseSummary(actor: AuthenticatedActor, input: ExpenseSummaryQuery) {
    const range = () => ({
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lte: input.to } : {}),
    });
    const base = {
      organizationId: actor.organizationId,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
    };
    const where: Prisma.ExpenseWhereInput = {
      ...base,
      OR: [
        { status: 'APPROVED', dueDate: range() },
        { status: 'PENDING_APPROVAL', dueDate: range() },
        { status: 'PAID', paidAt: range() },
      ],
    };
    const [groups, overdueGroups] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['status', 'currency'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['currency'],
        where: {
          ...base,
          status: 'APPROVED',
          dueDate: {
            lt: new Date(new Date().toISOString().slice(0, 10)),
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const currencies = [
      ...new Set([
        ...groups.map(({ currency }) => currency),
        ...overdueGroups.map(({ currency }) => currency),
      ]),
    ].sort();
    return {
      currencies: currencies.map((currency) => {
        const summary = (status: string) => {
          const group = groups.find((item) => item.currency === currency && item.status === status);
          return {
            count: group?._count._all ?? 0,
            amount: group?._sum.amount?.toFixed(4) ?? '0.0000',
          };
        };
        const overdue = overdueGroups.find((item) => item.currency === currency);
        return {
          currency,
          pendingApproval: summary('PENDING_APPROVAL'),
          pendingPayment: summary('APPROVED'),
          overdue: {
            count: overdue?._count._all ?? 0,
            amount: overdue?._sum.amount?.toFixed(4) ?? '0.0000',
          },
          paid: summary('PAID'),
        };
      }),
    };
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
    const affectedReceivableIds = new Set(
      input.allocations.map(
        ({ installmentId }) => installmentById.get(installmentId)!.receivable.id,
      ),
    );
    for (const receivableId of affectedReceivableIds)
      await this.refreshReceivableStatus(transaction, actor.organizationId, receivableId);
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

  private expenseApprovalRequired(settings: Prisma.JsonValue): boolean {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const configured = (settings as Prisma.JsonObject).expenseApprovalRequired;
      if (typeof configured === 'boolean') return configured;
    }
    return true;
  }

  private async hasIndependentExpenseApprover(
    transaction: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    creatorUserId: string,
  ): Promise<boolean> {
    const count = await transaction.organizationMember.count({
      where: {
        organizationId,
        userId: { not: creatorUserId },
        status: 'ACTIVE',
        user: { status: 'ACTIVE', deletedAt: null },
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: { organizationId, resource: 'expenses', action: 'approve' },
                },
              },
            },
          },
        },
      },
    });
    return count > 0;
  }

  private async assertExpenseLinks(
    transaction: Transaction,
    organizationId: string,
    clientId?: string,
    matterId?: string,
    responsibleUserId?: string,
  ): Promise<string | undefined> {
    const [client, matter, responsible] = await Promise.all([
      clientId
        ? transaction.client.findFirst({
            where: { id: clientId, organizationId, deletedAt: null },
            select: { id: true },
          })
        : { id: null },
      matterId
        ? transaction.matter.findFirst({
            where: { id: matterId, organizationId, deletedAt: null },
            select: { id: true, clientId: true },
          })
        : { id: null, clientId: null },
      responsibleUserId
        ? transaction.organizationMember.findFirst({
            where: {
              userId: responsibleUserId,
              organizationId,
              status: 'ACTIVE',
              user: { status: 'ACTIVE', deletedAt: null },
            },
            select: { userId: true },
          })
        : { id: null },
    ]);
    if (clientId && !client) throw new NotFoundException('Cliente não encontrado');
    if (matterId && !matter) throw new NotFoundException('Processo não encontrado');
    if (responsibleUserId && !responsible)
      throw new NotFoundException('Responsável ativo não encontrado neste escritório');
    if (clientId && matter?.clientId && clientId !== matter.clientId)
      throw new BadRequestException('O processo pertence a outro cliente');
    return clientId ?? matter?.clientId ?? undefined;
  }

  private async lockExpense(transaction: Transaction, actor: AuthenticatedActor, id: string) {
    await transaction.$queryRaw`
      SELECT id FROM expenses
       WHERE id = ${id}::uuid AND organization_id = ${actor.organizationId}::uuid
       FOR UPDATE`;
    const expense = await this.findExpense(actor, id, transaction);
    if (!expense) throw new NotFoundException('Despesa não encontrada');
    return expense;
  }

  private findExpense(actor: AuthenticatedActor, id: string, transaction: Transaction) {
    const canViewDocuments = actor.permissions.includes('documents:view');
    return transaction.expense.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      include: {
        client: { select: { id: true, displayName: true } },
        matter: { select: { id: true, reference: true } },
        responsibleUser: { select: { id: true, fullName: true } },
        ...(canViewDocuments
          ? {
              documents: {
                where: {
                  deletedAt: null,
                  ...(actor.clientId
                    ? { visibility: 'CLIENT' as const, clientId: actor.clientId }
                    : {}),
                },
                select: { id: true, title: true, visibility: true },
              },
            }
          : {}),
      },
    });
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
    await this.refreshReceivableStatus(transaction, organizationId, installment.receivableId);
  }

  private async refreshReceivableStatus(
    transaction: Transaction,
    organizationId: string,
    receivableId: string,
  ): Promise<void> {
    const receivable = await transaction.receivable.findFirst({
      where: { id: receivableId, organizationId },
      select: { status: true },
    });
    if (!receivable || ['DRAFT', 'CANCELLED', 'WRITTEN_OFF'].includes(receivable.status)) return;

    const installments = await transaction.receivableInstallment.findMany({
      where: { receivableId, organizationId },
      select: { status: true },
    });
    const activeInstallments = installments.filter(
      ({ status }) => !['CANCELLED', 'RENEGOTIATED'].includes(status),
    );
    if (activeInstallments.length === 0) return;

    const nextStatus = activeInstallments.every(({ status }) => status === 'PAID')
      ? 'PAID'
      : activeInstallments.some(({ status }) => ['PAID', 'PARTIALLY_PAID'].includes(status))
        ? 'PARTIALLY_PAID'
        : activeInstallments.some(({ status }) => status === 'OVERDUE')
          ? 'OVERDUE'
          : 'OPEN';
    if (receivable.status !== nextStatus)
      await transaction.receivable.updateMany({
        where: { id: receivableId, organizationId },
        data: { status: nextStatus },
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
