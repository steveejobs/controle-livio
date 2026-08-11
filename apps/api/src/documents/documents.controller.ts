import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  documentListQuerySchema,
  documentMetadataSchema,
  type DocumentListQuery,
  type DocumentMetadataInput,
} from './document.schemas';
import { DocumentsService } from './documents.service';

const versionQuerySchema = z.object({ version: z.coerce.number().int().min(1).optional() });

@ApiTags('Documentos')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  @RequirePermission('documents:create')
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(documentMetadataSchema)) metadata: DocumentMetadataInput,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.create(actor, metadata, file);
  }

  @Post(':id/versions')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  @RequirePermission('documents:update')
  addVersion(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.addVersion(actor, id, file);
  }

  @Get(':id')
  @RequirePermission('documents:view')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.getDocument(actor, id);
  }

  @Get(':id/download-url')
  @RequirePermission('documents:view')
  downloadUrl(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(versionQuerySchema)) query: { version?: number },
  ) {
    return this.documents.downloadUrl(actor, id, query.version);
  }
  @Get()
  @RequirePermission('documents:view')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(documentListQuerySchema)) query: DocumentListQuery,
  ) {
    return this.documents.list(actor, query);
  }
}
