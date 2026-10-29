import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { Public } from '../auth/public.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createDocumentSigningRequestSchema,
  signDocumentSchema,
  type CreateDocumentSigningRequestInput,
  type SignDocumentInput,
} from './document-signing.schemas';
import { DocumentSigningService } from './document-signing.service';

@ApiTags('Assinatura de documentos')
@Controller()
export class DocumentSigningController {
  constructor(private readonly signing: DocumentSigningService) {}

  @Post('documents/:id/signature-requests')
  @RequirePermission('documents:create')
  createRequest(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createDocumentSigningRequestSchema))
    input: CreateDocumentSigningRequestInput,
  ) {
    return this.signing.createRequest(actor, id, input);
  }

  @Post('documents/signature-requests/:id/revoke')
  @RequirePermission('documents:update')
  revokeRequest(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.signing.revokeRequest(actor, id);
  }

  @Get('public/signatures/:token')
  @Public()
  details(@Param('token') token: string) {
    return this.signing.publicDetails(token);
  }

  @Post('public/signatures/:token/sign')
  @Public()
  sign(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signDocumentSchema)) input: SignDocumentInput,
  ) {
    return this.signing.sign(token, input);
  }
}
