import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DOCUMENT_UPLOAD_BUFFER_LIMITS } from '../documents/document-upload-limits';
import {
  DocumentUploadAdmissionInterceptor,
  DocumentUploadBodyLimitGuard,
} from '../documents/document-upload-guards';
import { ReceiptService } from './receipt.service';
import {
  receiptConfirmationSchema,
  receiptDecisionSchema,
  receiptUploadSchema,
  type ReceiptConfirmationInput,
  type ReceiptDecisionInput,
  type ReceiptUploadInput,
} from './receipt.schemas';

const receiptListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'NEEDS_CORRECTION']).optional(),
  installmentId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});

@ApiTags('Comprovantes financeiros')
@Controller('finance/receipts')
export class ReceiptController {
  constructor(private readonly receipts: ReceiptService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseGuards(DocumentUploadBodyLimitGuard)
  @UseInterceptors(
    DocumentUploadAdmissionInterceptor,
    FileInterceptor('file', { limits: DOCUMENT_UPLOAD_BUFFER_LIMITS }),
  )
  @RequirePermission('receipts:create')
  submit(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(receiptUploadSchema)) input: ReceiptUploadInput,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.receipts.submit(actor, input, file);
  }

  @Get()
  @RequirePermission('receipts:view')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(receiptListQuery)) query: z.infer<typeof receiptListQuery>,
  ) {
    return this.receipts.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('receipts:view')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.get(actor, id);
  }

  @Post(':id/confirm')
  @RequirePermission('receipts:approve')
  confirm(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(receiptConfirmationSchema)) input: ReceiptConfirmationInput,
  ) {
    return this.receipts.confirm(actor, id, input);
  }

  @Post(':id/decision')
  @RequirePermission('receipts:approve')
  decide(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(receiptDecisionSchema)) input: ReceiptDecisionInput,
  ) {
    return this.receipts.decide(actor, id, input);
  }
}
