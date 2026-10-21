import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  adjustmentSchema,
  createContractSchema,
  createServiceCatalogItemSchema,
  createExpenseSchema,
  createPaymentSchema,
  paymentChangeSchema,
  paymentChangeDecisionSchema,
  createReceivableSchema,
  renegotiationSchema,
  reversalSchema,
  type AdjustmentInput,
  type CreateContractInput,
  type CreateServiceCatalogItemInput,
  type CreateExpenseInput,
  type CreatePaymentInput,
  type PaymentChangeInput,
  type PaymentChangeDecisionInput,
  type CreateReceivableInput,
  type RenegotiationInput,
  type ReversalInput,
  financeListQuerySchema,
  type FinanceListQuery,
} from './finance.schemas';
import { FinanceService } from './finance.service';
import { RequireAdministrator } from '../auth/require-administrator.decorator';
import { ServiceCatalogService } from './service-catalog.service';

@ApiTags('Financeiro')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly serviceCatalog: ServiceCatalogService,
  ) {}

  @Get('service-catalog')
  @RequirePermission('contracts:view')
  serviceCatalogItems(@CurrentActor() actor: AuthenticatedActor) {
    return this.serviceCatalog.list(actor);
  }

  @Post('service-catalog')
  @RequirePermission('contracts:create')
  createServiceCatalogItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createServiceCatalogItemSchema))
    input: CreateServiceCatalogItemInput,
  ) {
    return this.serviceCatalog.create(actor, input);
  }

  @Post('contracts')
  @RequirePermission('contracts:create')
  createContract(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createContractSchema)) input: CreateContractInput,
  ) {
    return this.finance.createContract(actor, input);
  }

  @Post('receivables')
  @RequirePermission('receivables:create')
  createReceivable(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createReceivableSchema)) input: CreateReceivableInput,
  ) {
    return this.finance.createReceivable(actor, input);
  }

  @Get('receivables/:id')
  @RequirePermission('receivables:view')
  getReceivable(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getReceivable(actor, id);
  }

  @Post('payments')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @RequirePermission('payments:create')
  createPayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ZodValidationPipe(createPaymentSchema)) input: CreatePaymentInput,
  ) {
    return this.finance.createPayment(actor, idempotencyKey, input);
  }

  @Post('payments/:id/reversal')
  @RequirePermission('payments:approve')
  @RequireAdministrator()
  reversePayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reversalSchema)) input: ReversalInput,
  ) {
    return this.finance.reversePayment(actor, id, input);
  }

  @Patch('payments/:id/change-requests')
  @RequirePermission('payments:update')
  requestPaymentChange(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paymentChangeSchema)) input: PaymentChangeInput,
  ) {
    return this.finance.requestPaymentChange(actor, id, input);
  }

  @Get('payments/change-requests')
  @RequirePermission('payments:update')
  paymentChangeRequests(@CurrentActor() actor: AuthenticatedActor) {
    return this.finance.listPaymentChangeRequests(actor);
  }

  @Post('payments/change-requests/:id/approve')
  @RequirePermission('payments:approve')
  @RequireAdministrator()
  approvePaymentChange(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.decidePaymentChange(actor, id, 'APPROVED');
  }

  @Post('payments/change-requests/:id/reject')
  @RequirePermission('payments:approve')
  @RequireAdministrator()
  rejectPaymentChange(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paymentChangeDecisionSchema)) input: PaymentChangeDecisionInput,
  ) {
    return this.finance.decidePaymentChange(actor, id, 'REJECTED', input);
  }

  @Post('installments/:id/adjustments')
  @RequirePermission('receivables:approve')
  addAdjustment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adjustmentSchema)) input: AdjustmentInput,
  ) {
    return this.finance.addAdjustment(actor, id, input);
  }

  @Post('receivables/:id/renegotiations')
  @RequirePermission('receivables:approve')
  renegotiate(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(renegotiationSchema)) input: RenegotiationInput,
  ) {
    return this.finance.renegotiate(actor, id, input);
  }

  @Post('expenses')
  @RequirePermission('expenses:create')
  createExpense(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createExpenseSchema)) input: CreateExpenseInput,
  ) {
    return this.finance.createExpense(actor, input);
  }
  @Get('contracts')
  @RequirePermission('contracts:view')
  contracts(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ) {
    return this.finance.listContracts(actor, query);
  }

  @Get('receivables')
  @RequirePermission('receivables:view')
  receivables(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ) {
    return this.finance.listReceivables(actor, query);
  }

  @Get('payments')
  @RequirePermission('payments:view')
  payments(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ) {
    return this.finance.listPayments(actor, query);
  }

  @Get('expenses')
  @RequirePermission('expenses:view')
  expenses(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ) {
    return this.finance.listExpenses(actor, query);
  }
}
