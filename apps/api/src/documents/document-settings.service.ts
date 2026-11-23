import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  DOCUMENT_TEMPLATE_CATEGORIES,
  DOCUMENT_TEMPLATE_LABELS,
  DOCUMENT_TEMPLATE_VARIABLES,
  validateDocumentTemplate,
  type DocumentTemplateCategory,
} from './document-templates';
import {
  documentTemplateUpdateSchema,
  officeDocumentSettingsSchema,
  type DocumentTemplateUpdateInput,
  type OfficeDocumentSettingsInput,
} from './document.schemas';

function settingsObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function storedOfficeSettings(value: unknown): OfficeDocumentSettingsInput | undefined {
  const parsed = officeDocumentSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

@Injectable()
export class DocumentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(actor: AuthenticatedActor) {
    this.assertAdministrator(actor);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { settings: true },
    });
    const office = storedOfficeSettings(settingsObject(organization.settings).legalDocuments);
    return { configured: Boolean(office), settings: office ?? null };
  }

  async update(actor: AuthenticatedActor, input: OfficeDocumentSettingsInput) {
    this.assertAdministrator(actor);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR UPDATE`;
      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { settings: true },
      });
      const settings = settingsObject(organization.settings);
      const currentLegalDocuments = settingsObject(settings.legalDocuments);
      const before = storedOfficeSettings(currentLegalDocuments);
      const savedTemplates = settingsObject(currentLegalDocuments.templates);
      const after = {
        ...input,
        ...(Object.keys(savedTemplates).length ? { templates: savedTemplates } : {}),
      };
      await transaction.organization.update({
        where: { id: actor.organizationId },
        data: { settings: { ...settings, legalDocuments: after } as Prisma.InputJsonValue },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'organization.document_settings',
        resourceId: actor.organizationId,
        before: { configured: Boolean(before) },
        after: { configured: true },
      });
      return { configured: true, settings: after };
    });
  }

  async forGeneration(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { settings: true },
    });
    return storedOfficeSettings(settingsObject(organization.settings).legalDocuments);
  }

  async getTemplates(actor: AuthenticatedActor) {
    this.assertAdministrator(actor);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { settings: true },
    });
    const legalSettings = settingsObject(settingsObject(organization.settings).legalDocuments);
    const savedTemplates = settingsObject(legalSettings.templates);
    return {
      templates: DOCUMENT_TEMPLATE_CATEGORIES.map((category) => {
        const saved = this.storedTemplate(category, savedTemplates[category]);
        return {
          category,
          label: DOCUMENT_TEMPLATE_LABELS[category],
          content: saved ?? DEFAULT_DOCUMENT_TEMPLATES[category],
          customized: Boolean(saved),
        };
      }),
      variables: DOCUMENT_TEMPLATE_VARIABLES,
    };
  }

  async updateTemplate(actor: AuthenticatedActor, input: DocumentTemplateUpdateInput) {
    this.assertAdministrator(actor);
    const parsed = documentTemplateUpdateSchema.parse(input);
    validateDocumentTemplate(parsed.category, parsed.content);
    return this.saveTemplate(actor, parsed.category, parsed.content);
  }

  async resetTemplate(actor: AuthenticatedActor, category: DocumentTemplateCategory) {
    this.assertAdministrator(actor);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR UPDATE`;
      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { settings: true },
      });
      const settings = settingsObject(organization.settings);
      const legalSettings = settingsObject(settings.legalDocuments);
      const savedTemplates = { ...settingsObject(legalSettings.templates) };
      const customized = this.storedTemplate(category, savedTemplates[category]) !== undefined;
      delete savedTemplates[category];
      const officeSettings = { ...legalSettings };
      delete officeSettings.templates;
      const nextLegalSettings = {
        ...officeSettings,
        ...(Object.keys(savedTemplates).length ? { templates: savedTemplates } : {}),
      };
      await transaction.organization.update({
        where: { id: actor.organizationId },
        data: {
          settings: { ...settings, legalDocuments: nextLegalSettings } as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'organization.document_template',
        resourceId: actor.organizationId,
        before: { category, customized },
        after: { category, customized: false },
      });
    });
    return this.getTemplates(actor);
  }

  async templateForGeneration(organizationId: string, category: DocumentTemplateCategory) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { settings: true },
    });
    const legalSettings = settingsObject(settingsObject(organization.settings).legalDocuments);
    return (
      this.storedTemplate(category, settingsObject(legalSettings.templates)[category]) ??
      DEFAULT_DOCUMENT_TEMPLATES[category]
    );
  }

  private async saveTemplate(
    actor: AuthenticatedActor,
    category: DocumentTemplateCategory,
    content: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR UPDATE`;
      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { settings: true },
      });
      const settings = settingsObject(organization.settings);
      const legalSettings = settingsObject(settings.legalDocuments);
      const savedTemplates = { ...settingsObject(legalSettings.templates) };
      const before = this.storedTemplate(category, savedTemplates[category]);
      savedTemplates[category] = content;
      await transaction.organization.update({
        where: { id: actor.organizationId },
        data: {
          settings: {
            ...settings,
            legalDocuments: { ...legalSettings, templates: savedTemplates },
          } as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'organization.document_template',
        resourceId: actor.organizationId,
        before: { category, customized: Boolean(before) },
        after: { category, customized: true },
      });
    });
    return this.getTemplates(actor);
  }

  private storedTemplate(category: DocumentTemplateCategory, value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 40_000) return undefined;
    try {
      validateDocumentTemplate(category, value);
      return value;
    } catch {
      return undefined;
    }
  }

  private assertAdministrator(actor: AuthenticatedActor): void {
    if (!actor.isAdministrator)
      throw new ForbiddenException('Apenas um administrador pode alterar os dados do escritório.');
  }
}
