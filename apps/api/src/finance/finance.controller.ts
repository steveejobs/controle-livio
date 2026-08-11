import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  adjustmentSchema,
  createContractSchema,
  createExpenseSchema,
  createPaymentSchema,
  createReceivableSchema,
  renegotiationSchema,
  reversalSchema,
  type AdjustmentInput,
  type CreateContractInput,
  type CreateExpenseInput,
  type CreatePaymentInput,
  type CreateReceivableInput,
  type RenegotiationInput,
  type ReversalInput,
  financeListQuerySchema,
  type FinanceListQuery,
} from './finance.schemas';
import { FinanceService } from './finance.service';

@ApiTags('Financeiro')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

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
  reversePayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reversalSchema)) input: ReversalInput,
  ) {
    return this.finance.reversePayment(actor, id, input);
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
