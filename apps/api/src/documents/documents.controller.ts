import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { RequireAdministrator } from '../auth/require-administrator.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  documentListQuerySchema,
  documentGenerationSchema,
  documentMetadataSchema,
  officeDocumentSettingsSchema,
  documentTemplateCategorySchema,
  documentTemplateUpdateSchema,
  type DocumentListQuery,
  type DocumentGenerationInput,
  type DocumentMetadataInput,
  type OfficeDocumentSettingsInput,
  type DocumentTemplateUpdateInput,
} from './document.schemas';
import { DocumentsService } from './documents.service';
import { DocumentSettingsService } from './document-settings.service';
import { DOCUMENT_UPLOAD_BUFFER_LIMITS } from './document-upload-limits';
export { DOCUMENT_UPLOAD_BUFFER_LIMITS };
import {
  DocumentUploadAdmissionInterceptor,
  DocumentUploadBodyLimitGuard,
} from './document-upload-guards';

const versionQuerySchema = z.object({ version: z.coerce.number().int().min(1).optional() });

@ApiTags('Documentos')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly settings: DocumentSettingsService,
  ) {}

  @Post('generate')
  @RequirePermission('documents:create')
  generate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(documentGenerationSchema)) input: DocumentGenerationInput,
  ) {
    return this.documents.generate(actor, input);
  }

  @Get('office-settings')
  @RequirePermission('organization:view')
  @RequireAdministrator()
  officeSettings(@CurrentActor() actor: AuthenticatedActor) {
    return this.settings.get(actor);
  }

  @Patch('office-settings')
  @RequirePermission('organization:update')
  @RequireAdministrator()
  updateOfficeSettings(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(officeDocumentSettingsSchema)) input: OfficeDocumentSettingsInput,
  ) {
    return this.settings.update(actor, input);
  }

  @Get('templates')
  @RequirePermission('organization:view')
  @RequireAdministrator()
  templates(@CurrentActor() actor: AuthenticatedActor) {
    return this.settings.getTemplates(actor);
  }

  @Patch('templates')
  @RequirePermission('organization:update')
  @RequireAdministrator()
  updateTemplate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(documentTemplateUpdateSchema)) input: DocumentTemplateUpdateInput,
  ) {
    return this.settings.updateTemplate(actor, input);
  }

  @Delete('templates/:category')
  @RequirePermission('organization:update')
  @RequireAdministrator()
  resetTemplate(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('category', new ZodValidationPipe(documentTemplateCategorySchema)) category: string,
  ) {
    return this.settings.resetTemplate(actor, category as DocumentTemplateUpdateInput['category']);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseGuards(DocumentUploadBodyLimitGuard)
  @UseInterceptors(
    DocumentUploadAdmissionInterceptor,
    FileInterceptor('file', { limits: DOCUMENT_UPLOAD_BUFFER_LIMITS }),
  )
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
  @UseGuards(DocumentUploadBodyLimitGuard)
  @UseInterceptors(
    DocumentUploadAdmissionInterceptor,
    FileInterceptor('file', { limits: DOCUMENT_UPLOAD_BUFFER_LIMITS }),
  )
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
