import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sanitizeFilename from 'sanitize-filename';
import { Prisma } from '@livio/db';
import type { ApiEnvironment, AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, pageWindow } from '../common/schemas';
import type {
  DocumentGenerationInput,
  DocumentListQuery,
  DocumentMetadataInput,
} from './document.schemas';
import { DocumentGeneratorService } from './document-generator.service';
import { DocumentSettingsService } from './document-settings.service';
import { StorageService } from './storage.service';

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly generator: DocumentGeneratorService,
    private readonly documentSettings: DocumentSettingsService,
  ) {}

  async generate(actor: AuthenticatedActor, input: DocumentGenerationInput) {
    if (!actor.permissions.includes('clients:view'))
      throw new ForbiddenException('Permissão insuficiente para consultar os dados do cliente');
    if (
      input.category === 'CONTRATO_HONORARIOS' &&
      (!actor.permissions.includes('contracts:view') ||
        !actor.permissions.includes('receivables:view'))
    ) {
      throw new ForbiddenException(
        'A geração do contrato exige acesso aos contratos e às cobranças do cliente',
      );
    }
    if (actor.clientId && actor.clientId !== input.clientId)
      throw new NotFoundException('Cliente não encontrado');
    const client = await this.prisma.client.findFirst({
      where: {
        id: input.clientId,
        organizationId: actor.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        displayName: true,
        legalName: true,
        taxIdNormalized: true,
        address: true,
        customFields: true,
      },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');

    const contract =
      input.category === 'CONTRATO_HONORARIOS' && input.contractId
        ? await this.prisma.contract.findFirst({
            where: {
              id: input.contractId,
              clientId: client.id,
              organizationId: actor.organizationId,
            },
            include: {
              matter: {
                select: {
                  reference: true,
                  title: true,
                  courtNumberNormalized: true,
                  area: true,
                },
              },
              receivables: {
                where: { status: { not: 'CANCELLED' } },
                orderBy: { issueDate: 'asc' },
                select: {
                  reference: true,
                  originalAmount: true,
                  currency: true,
                  installments: {
                    where: { cancelledAt: null },
                    orderBy: { sequence: 'asc' },
                    select: { sequence: true, amount: true, dueDate: true },
                  },
                },
              },
            },
          })
        : undefined;
    if (input.category === 'CONTRATO_HONORARIOS' && !contract)
      throw new NotFoundException('Contrato não encontrado para este cliente');

    const office =
      input.category === 'HIPOSSUFICIENCIA'
        ? undefined
        : await this.documentSettings.forGeneration(actor.organizationId);
    const template = await this.documentSettings.templateForGeneration(
      actor.organizationId,
      input.category,
    );
    const generationOptions = {
      template,
      ...(contract
        ? {
            contract: {
              ...contract,
              fixedAmount: contract.fixedAmount?.toString() ?? null,
              successRate: contract.successRate?.toString() ?? null,
              receivables: contract.receivables.map((receivable) => ({
                ...receivable,
                originalAmount: receivable.originalAmount.toString(),
                installments: receivable.installments.map((installment) => ({
                  ...installment,
                  amount: installment.amount.toString(),
                })),
              })),
            },
          }
        : {}),
      ...(office ? { office } : {}),
    };
    const fileBuffer = await this.generator.generate(input.category, client, generationOptions);
    const pdfBuffer = await this.generator.generatePdf(input.category, client, generationOptions);
    const titleByCategory = {
      CONTRATO_HONORARIOS: 'Contrato de honorários',
      PROCURACAO: 'Procuração',
      HIPOSSUFICIENCIA: 'Declaração de hipossuficiência',
    } as const;
    const title = `Gerado automaticamente · ${titleByCategory[input.category]}${contract ? ` · ${contract.number}` : ''}`;
    const originalname = this.safeName(
      `${titleByCategory[input.category]}-${client.displayName}.docx`,
    );
    const file = {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: fileBuffer.length,
      buffer: fileBuffer,
    } as Express.Multer.File;
    const metadata: DocumentMetadataInput = {
      title,
      category: input.category,
      visibility: 'INTERNAL',
      clientId: client.id,
      ...(contract ? { contractId: contract.id } : {}),
      ...(contract?.matterId ? { matterId: contract.matterId } : {}),
    };

    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId: actor.organizationId,
        clientId: client.id,
        category: input.category,
        title: { startsWith: 'Gerado automaticamente ·' },
        deletedAt: null,
        contractId: contract?.id ?? null,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await this.addVersion(actor, existing.id, file);
      await this.addVersion(actor, existing.id, {
        ...file,
        originalname: this.safeName(`${titleByCategory[input.category]}-${client.displayName}.pdf`),
        mimetype: 'application/pdf',
        size: pdfBuffer.length,
        buffer: pdfBuffer,
      });
      return this.getDocument(actor, existing.id);
    }
    const created = await this.create(actor, metadata, file, 'DRAFT');
    await this.addVersion(actor, created.id, {
      ...file,
      originalname: this.safeName(`${titleByCategory[input.category]}-${client.displayName}.pdf`),
      mimetype: 'application/pdf',
      size: pdfBuffer.length,
      buffer: pdfBuffer,
    });
    return this.getDocument(actor, created.id);
  }

  async create(
    actor: AuthenticatedActor,
    metadata: DocumentMetadataInput,
    file: Express.Multer.File,
    status: 'ACTIVE' | 'DRAFT' = 'ACTIVE',
  ) {
    this.validateFile(file);
    await this.assertLinks(actor.organizationId, metadata);
    const documentId = randomUUID();
    const storageKey = `organizations/${actor.organizationId}/documents/${documentId}/${randomUUID()}-${this.safeName(file.originalname)}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);
    try {
      const document = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.document.create({
          data: {
            id: documentId,
            organizationId: actor.organizationId,
            title: metadata.title,
            category: metadata.category,
            visibility: metadata.visibility,
            confidential: metadata.visibility === 'INTERNAL',
            status,
            createdById: actor.userId,
            ...(metadata.clientId ? { clientId: metadata.clientId } : {}),
            ...(metadata.matterId ? { matterId: metadata.matterId } : {}),
            ...(metadata.contractId ? { contractId: metadata.contractId } : {}),
            ...(metadata.installmentId ? { installmentId: metadata.installmentId } : {}),
            ...(metadata.paymentId ? { paymentId: metadata.paymentId } : {}),
            ...(metadata.expenseId ? { expenseId: metadata.expenseId } : {}),
            versions: {
              create: {
                organizationId: actor.organizationId,
                version: 1,
                storageKey,
                fileName: this.safeName(file.originalname),
                mimeType: file.mimetype,
                sizeBytes: BigInt(file.size),
                sha256: this.digest(file.buffer),
                uploadedById: actor.userId,
              },
            },
          },
          include: { versions: true },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'document',
          resourceId: created.id,
          after: { title: created.title, visibility: created.visibility, version: 1 },
        });
        return created;
      });
      return this.serialize(document);
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  async addVersion(actor: AuthenticatedActor, documentId: string, file: Express.Multer.File) {
    this.validateFile(file);
    await this.getDocument(actor, documentId);
    const storageKey = `organizations/${actor.organizationId}/documents/${documentId}/${randomUUID()}-${this.safeName(file.originalname)}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);
    try {
      const version = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM documents WHERE id = ${documentId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
          const document = await transaction.document.findFirst({
            where: { id: documentId, organizationId: actor.organizationId, deletedAt: null },
          });
          if (!document) throw new NotFoundException('Documento não encontrado');
          const nextVersion = document.currentVersion + 1;
          const created = await transaction.documentVersion.create({
            data: {
              organizationId: actor.organizationId,
              documentId,
              version: nextVersion,
              storageKey,
              fileName: this.safeName(file.originalname),
              mimeType: file.mimetype,
              sizeBytes: BigInt(file.size),
              sha256: this.digest(file.buffer),
              uploadedById: actor.userId,
            },
          });
          await transaction.document.update({
            where: { id: documentId },
            data: { currentVersion: nextVersion },
          });
          const revokedRequests = await transaction.documentSigningRequest.updateMany({
            where: { organizationId: actor.organizationId, documentId, status: 'PENDING' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
          await this.audit.record(transaction, {
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            actorSessionId: actor.sessionId,
            action: 'UPDATE',
            resource: 'document',
            resourceId: documentId,
            before: { currentVersion: document.currentVersion },
            after: {
              currentVersion: nextVersion,
              sha256: created.sha256,
              revokedSignatureLinks: revokedRequests.count,
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.serializeVersion(version);
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  async getDocument(actor: AuthenticatedActor, id: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { clientId: actor.clientId, visibility: 'CLIENT' } : {}),
      },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    return this.serialize(document);
  }

  async list(actor: AuthenticatedActor, query: DocumentListQuery) {
    const where = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(actor.clientId
        ? { clientId: actor.clientId, visibility: 'CLIENT' as const }
        : query.clientId
          ? { clientId: query.clientId }
          : {}),
      ...(query.matterId ? { matterId: query.matterId } : {}),
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.paymentId ? { paymentId: query.paymentId } : {}),
      ...(query.expenseId ? { expenseId: query.expenseId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        ...pageWindow(query),
        include: {
          client: { select: { id: true, displayName: true } },
          versions: { orderBy: { version: 'desc' }, take: 10 },
          signingRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, signerName: true, status: true, expiresAt: true, signedAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);
    return pageResult(
      items.map((item) => this.serialize(item)),
      total,
      query,
    );
  }

  async downloadUrl(actor: AuthenticatedActor, documentId: string, versionNumber?: number) {
    await this.getDocument(actor, documentId);
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        documentId,
        organizationId: actor.organizationId,
        ...(versionNumber ? { version: versionNumber } : {}),
      },
      orderBy: { version: 'desc' },
    });
    if (!version) throw new NotFoundException('Versão não encontrada');
    return {
      url: await this.storage.signedUrl(version.storageKey, 300),
      expiresInSeconds: 300,
      version: version.version,
    };
  }

  private validateFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    const maximum = this.config.get('MAX_DOCUMENT_SIZE_MB', { infer: true }) * 1024 * 1024;
    if (file.size < 1 || file.size > maximum)
      throw new BadRequestException('Tamanho de arquivo inválido');
    if (!allowedMimeTypes.has(file.mimetype) || !this.magicMatches(file.buffer, file.mimetype))
      throw new BadRequestException('Tipo de arquivo não permitido ou conteúdo incompatível');
  }

  private magicMatches(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
    if (mimeType === 'image/png')
      return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === 'image/jpeg')
      return (
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
      );
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  private async assertLinks(
    organizationId: string,
    metadata: DocumentMetadataInput,
  ): Promise<void> {
    const [client, matter, contract, installment, payment, expense] = await Promise.all([
      metadata.clientId
        ? this.prisma.client.findFirst({
            where: { id: metadata.clientId, organizationId, deletedAt: null },
            select: { id: true },
          })
        : { id: null },
      metadata.matterId
        ? this.prisma.matter.findFirst({
            where: { id: metadata.matterId, organizationId, deletedAt: null },
            select: { clientId: true },
          })
        : { clientId: null },
      metadata.contractId
        ? this.prisma.contract.findFirst({
            where: { id: metadata.contractId, organizationId },
            select: { clientId: true },
          })
        : { clientId: null },
      metadata.installmentId
        ? this.prisma.receivableInstallment.findFirst({
            where: { id: metadata.installmentId, organizationId },
            select: { receivable: { select: { clientId: true } } },
          })
        : { receivable: { clientId: null } },
      metadata.paymentId
        ? this.prisma.payment.findFirst({
            where: { id: metadata.paymentId, organizationId },
            select: { clientId: true },
          })
        : { clientId: null },
      metadata.expenseId
        ? this.prisma.expense.findFirst({
            where: { id: metadata.expenseId, organizationId },
            select: { clientId: true, matter: { select: { clientId: true } } },
          })
        : { clientId: null, matter: { clientId: null } },
    ]);
    if (!client || !matter || !contract || !installment || !payment || !expense)
      throw new NotFoundException('Vínculo do documento não encontrado');
    const linkedClients = [
      metadata.clientId,
      matter.clientId,
      contract.clientId,
      installment.receivable.clientId,
      payment.clientId,
      expense.clientId,
      expense.matter?.clientId,
    ].filter((value): value is string => Boolean(value));
    if (new Set(linkedClients).size > 1)
      throw new BadRequestException('Vínculos do documento pertencem a clientes diferentes');
  }

  private safeName(name: string): string {
    const sanitized = sanitizeFilename(name)
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '');
    if (!sanitized || sanitized === '.' || sanitized === '..')
      throw new BadRequestException('Nome de arquivo inválido');
    return sanitized.slice(0, 180);
  }

  private digest(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private serialize<T extends { versions?: { sizeBytes: bigint }[] }>(document: T) {
    return {
      ...document,
      ...(document.versions
        ? { versions: document.versions.map((version) => this.serializeVersion(version)) }
        : {}),
    };
  }

  private serializeVersion<T extends { sizeBytes: bigint }>(version: T) {
    return { ...version, sizeBytes: version.sizeBytes.toString() };
  }
}
