import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sanitizeFilename from 'sanitize-filename';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentScannerService } from './document-scanner.service';
import { StorageService } from './storage.service';

const signatureBucket = 'document-signatures';
const signatureMime = 'image/png';
const signatureLimit = 500 * 1024;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenHash(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new NotFoundException('Link indisponível ou expirado.');
  return sha256(token);
}

function comparableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

@Injectable()
export class DocumentSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly scanner: DocumentScannerService,
  ) {}

  async createRequest(
    actor: AuthenticatedActor,
    documentId: string,
    input: { signerName?: string; expiresInDays: number },
  ) {
    if (
      actor.clientId ||
      !actor.permissions.includes('documents:create') ||
      !actor.permissions.includes('clients:view')
    )
      throw new ForbiddenException('Permissão insuficiente para solicitar assinatura.');
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: actor.organizationId, deletedAt: null },
      include: {
        client: {
          select: {
            id: true,
            type: true,
            displayName: true,
            legalName: true,
            email: true,
            phone: true,
            customFields: true,
          },
        },
        versions: { where: { mimeType: 'application/pdf' }, orderBy: { version: 'desc' }, take: 1 },
      },
    });
    const version = document?.versions[0];
    if (!document || !document.client)
      throw new NotFoundException('Vincule o documento a um cliente.');
    if (!version || version.version !== document.currentVersion)
      throw new BadRequestException(
        'A versão atual precisa ser PDF. Exporte o arquivo conferido para PDF e envie-o como nova versão antes de solicitar a assinatura.',
      );
    const custom =
      document.client.customFields && typeof document.client.customFields === 'object'
        ? (document.client.customFields as Record<string, unknown>)
        : {};
    const representative =
      custom.legalRepresentative && typeof custom.legalRepresentative === 'object'
        ? (custom.legalRepresentative as Record<string, unknown>)
        : {};
    const registeredRepresentative =
      typeof representative.name === 'string' ? representative.name.trim() : '';
    if (
      document.client.type === 'COMPANY' &&
      !input.signerName?.trim() &&
      !registeredRepresentative
    )
      throw new BadRequestException('Informe o nome completo do representante legal que assinará.');
    const defaultSigner =
      document.client.type === 'COMPANY' ? registeredRepresentative : document.client.displayName;
    const signerName = input.signerName?.trim() || defaultSigner;
    if (signerName.length < 3 || signerName.length > 200)
      throw new BadRequestException('Informe o nome completo de quem assinará.');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const created = await this.prisma.$transaction(async (transaction) => {
      const request = await transaction.documentSigningRequest.create({
        data: {
          organizationId: actor.organizationId,
          documentId,
          sourceVersion: version.version,
          tokenHash: sha256(token),
          signerName,
          createdById: actor.userId,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'document_signing_request',
        resourceId: request.id,
        after: {
          documentId,
          sourceVersion: version.version,
          signerName,
          expiresAt,
        },
      });
      return request;
    });
    return {
      id: created.id,
      token,
      signerName,
      documentTitle: document.title,
      expiresAt: created.expiresAt,
      client: {
        name: document.client.displayName,
        email: document.client.email,
        phone: document.client.phone,
      },
    };
  }

  async revokeRequest(actor: AuthenticatedActor, requestId: string) {
    if (actor.clientId || !actor.permissions.includes('documents:update'))
      throw new ForbiddenException('Permissão insuficiente para cancelar o link.');
    const request = await this.prisma.documentSigningRequest.findFirst({
      where: { id: requestId, organizationId: actor.organizationId, status: 'PENDING' },
      select: { id: true, documentId: true, signerName: true },
    });
    if (!request) throw new NotFoundException('Link pendente não encontrado.');
    await this.prisma.$transaction(async (transaction) => {
      const revokedAt = new Date();
      const changed = await transaction.documentSigningRequest.updateMany({
        where: { id: request.id, organizationId: actor.organizationId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt },
      });
      if (changed.count !== 1)
        throw new ConflictException('O link já foi assinado, expirou ou foi cancelado.');
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CANCEL',
        resource: 'document_signing_request',
        resourceId: request.id,
        before: { status: 'PENDING' },
        after: {
          status: 'REVOKED',
          documentId: request.documentId,
          signerName: request.signerName,
        },
      });
    });
    return { id: request.id, status: 'REVOKED' };
  }

  async publicDetails(token: string) {
    const hashed = tokenHash(token);
    const request = await this.prisma.documentSigningRequest.findUnique({
      where: { tokenHash: hashed },
      include: { document: { select: { title: true } }, sourceDocumentVersion: true },
    });
    if (!request) throw new NotFoundException('Link indisponível ou expirado.');
    await this.throttle(request.organizationId, hashed, 'view', 20);
    if (request.status === 'SIGNED')
      return {
        status: 'SIGNED',
        documentTitle: request.document.title,
        signedAt: request.signedAt,
      };
    if (request.status === 'PROCESSING') {
      const staleBefore = new Date(Date.now() - 3 * 60 * 1000);
      if (request.updatedAt <= staleBefore) {
        const recovered = await this.prisma.documentSigningRequest.updateMany({
          where: { id: request.id, status: 'PROCESSING', updatedAt: { lte: staleBefore } },
          data: { status: 'PENDING' },
        });
        if (recovered.count === 0)
          return { status: 'PROCESSING', documentTitle: request.document.title };
      } else {
        return { status: 'PROCESSING', documentTitle: request.document.title };
      }
    }
    if (
      request.status === 'REVOKED' ||
      request.status === 'EXPIRED' ||
      request.expiresAt <= new Date()
    ) {
      if (request.status === 'PENDING' && request.expiresAt <= new Date())
        await this.prisma.documentSigningRequest.updateMany({
          where: { id: request.id, status: 'PENDING', expiresAt: { lte: new Date() } },
          data: { status: 'EXPIRED' },
        });
      throw new GoneException(
        'Este link foi cancelado ou expirou. Solicite um novo ao escritório.',
      );
    }
    if (request.sourceDocumentVersion.mimeType !== 'application/pdf')
      throw new GoneException('O documento vinculado não está disponível para assinatura.');
    await this.prisma.documentSigningRequest.updateMany({
      where: { id: request.id, status: 'PENDING', viewedAt: null },
      data: { viewedAt: new Date() },
    });
    return {
      status: 'PENDING',
      documentTitle: request.document.title,
      signerName: request.signerName,
      expiresAt: request.expiresAt,
      sourceVersion: request.sourceVersion,
      sourceSha256: request.sourceDocumentVersion.sha256,
      documentUrl: await this.storage.signedUrl(request.sourceDocumentVersion.storageKey, 300),
    };
  }

  async sign(token: string, input: { signerName: string; consent: boolean; signature: string }) {
    const hashed = tokenHash(token);
    const request = await this.prisma.documentSigningRequest.findUnique({
      where: { tokenHash: hashed },
      include: {
        document: { include: { client: { select: { id: true } } } },
        sourceDocumentVersion: true,
      },
    });
    if (!request) throw new NotFoundException('Link indisponível ou expirado.');
    await this.throttle(request.organizationId, hashed, 'sign', 5);
    if (request.status !== 'PENDING' || request.expiresAt <= new Date())
      throw new GoneException('Este link já foi usado, cancelado ou expirou.');
    if (comparableName(input.signerName) !== comparableName(request.signerName))
      throw new BadRequestException(
        'O nome digitado precisa corresponder ao nome indicado no convite.',
      );
    if (!input.consent)
      throw new BadRequestException('Confirme que leu o documento e deseja assiná-lo.');
    const signature = this.decodeSignature(input.signature);
    const claimed = await this.prisma.documentSigningRequest.updateMany({
      where: { id: request.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1)
      throw new ConflictException('Este link já está sendo usado ou expirou.');

    const signedAt = new Date();
    const signatureHash = sha256(signature);
    const signatureStorageKey = `organizations/${request.organizationId}/signatures/${request.id}/${randomUUID()}.png`;
    const signedDocumentId = randomUUID();
    const signedStorageKey = `organizations/${request.organizationId}/documents/${signedDocumentId}/${randomUUID()}-assinado.pdf`;
    let signatureStored = false;
    let signedDocumentStored = false;
    try {
      const original = await this.storage.download(request.sourceDocumentVersion.storageKey);
      await this.scanner.assertClean(original, request.sourceDocumentVersion.mimeType);
      await this.scanner.assertClean(signature, signatureMime);
      const signedPdf = await this.appendSignature(original, signature, {
        title: request.document.title,
        signerName: request.signerName,
        signedAt,
        sourceVersion: request.sourceVersion,
        sourceSha256: request.sourceDocumentVersion.sha256,
        signatureSha256: signatureHash,
      });
      await this.scanner.assertClean(signedPdf, 'application/pdf');
      await this.storage.upload(signatureStorageKey, signature, signatureMime, signatureBucket);
      signatureStored = true;
      await this.storage.upload(signedStorageKey, signedPdf, 'application/pdf');
      signedDocumentStored = true;

      await this.prisma.$transaction(async (transaction) => {
        await transaction.document.create({
          data: {
            id: signedDocumentId,
            organizationId: request.organizationId,
            clientId: request.document.clientId,
            matterId: request.document.matterId,
            contractId: request.document.contractId,
            title: `${request.document.title} · Assinado`,
            category: request.document.category,
            status: 'ACTIVE',
            visibility: 'INTERNAL',
            confidential: true,
            currentVersion: 1,
            createdById: request.createdById,
            versions: {
              create: {
                organizationId: request.organizationId,
                version: 1,
                storageKey: signedStorageKey,
                fileName: sanitizeFilename(`${request.document.title}-assinado.pdf`).slice(0, 180),
                mimeType: 'application/pdf',
                sizeBytes: BigInt(signedPdf.length),
                sha256: sha256(signedPdf),
                uploadedById: request.createdById,
              },
            },
          },
        });
        const updated = await transaction.documentSigningRequest.updateMany({
          where: { id: request.id, status: 'PROCESSING' },
          data: {
            status: 'SIGNED',
            signedAt,
            signatureStorageKey,
            signatureSha256: signatureHash,
            signedDocumentId,
          },
        });
        if (updated.count !== 1)
          throw new ConflictException('A assinatura não pôde ser finalizada.');
        await this.audit.record(transaction, {
          organizationId: request.organizationId,
          action: 'UPDATE',
          resource: 'document_signing_request',
          resourceId: request.id,
          before: { status: 'PROCESSING' },
          after: {
            status: 'SIGNED',
            signedAt,
            signedName: request.signerName,
            sourceVersion: request.sourceVersion,
          },
          metadata: {
            documentId: request.documentId,
            signedDocumentId,
            sourceSha256: request.sourceDocumentVersion.sha256,
            signatureSha256: signatureHash,
          },
        });
      });
      return { status: 'SIGNED', signedAt, signedDocumentId };
    } catch (error) {
      if (signatureStored) await this.storage.remove(signatureStorageKey, signatureBucket);
      if (signedDocumentStored) await this.storage.remove(signedStorageKey);
      await this.prisma.documentSigningRequest.updateMany({
        where: { id: request.id, status: 'PROCESSING' },
        data: { status: 'PENDING' },
      });
      throw error;
    }
  }

  private decodeSignature(dataUrl: string): Buffer {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new BadRequestException('A assinatura precisa ser uma imagem PNG válida.');
    const image = Buffer.from(match[1]!, 'base64');
    if (
      image.length < 100 ||
      image.length > signatureLimit ||
      !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      throw new BadRequestException('A imagem da assinatura está inválida ou excede 500 KB.');
    }
    return image;
  }

  private async appendSignature(
    original: Buffer,
    signature: Buffer,
    evidence: {
      title: string;
      signerName: string;
      signedAt: Date;
      sourceVersion: number;
      sourceSha256: string;
      signatureSha256: string;
    },
  ): Promise<Buffer> {
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(original, { updateMetadata: false });
    } catch {
      throw new BadRequestException('Não foi possível abrir este PDF para anexar a assinatura.');
    }
    const page = pdf.addPage([595.28, 841.89]);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const image = await pdf.embedPng(signature);
    const left = 58;
    let y = 770;
    page.drawText('REGISTRO DE ASSINATURA ELETRÔNICA', {
      x: left,
      y,
      font: bold,
      size: 15,
      color: rgb(0.08, 0.24, 0.2),
    });
    y -= 34;
    const details = [
      `Documento: ${evidence.title}`,
      `Assinante: ${evidence.signerName}`,
      `Data e hora: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(evidence.signedAt)}`,
      `Versão conferida: ${evidence.sourceVersion}`,
      `SHA-256 do documento conferido: ${evidence.sourceSha256}`,
      `SHA-256 da imagem da assinatura: ${evidence.signatureSha256}`,
    ];
    for (const line of details) {
      const chunks = this.wrap(line, regular, 9.5, 478);
      for (const chunk of chunks) {
        page.drawText(chunk, {
          x: left,
          y,
          size: 9.5,
          font: regular,
          color: rgb(0.15, 0.17, 0.16),
        });
        y -= 17;
      }
      y -= 5;
    }
    y -= 5;
    page.drawText('Assinatura registrada', {
      x: left,
      y,
      size: 10,
      font: bold,
      color: rgb(0.15, 0.17, 0.16),
    });
    y -= 12;
    const imageWidth = Math.min(240, image.width);
    const imageHeight = Math.min(92, (image.height / image.width) * imageWidth);
    page.drawImage(image, { x: left, y: y - imageHeight, width: imageWidth, height: imageHeight });
    y -= imageHeight + 28;
    const statement =
      'O assinante confirmou que revisou o documento exibido, que o nome informado o identifica e que concorda em assinar eletronicamente a versão indicada. Este registro reúne a manifestação, a imagem manuscrita e os hashes dos arquivos associados.';
    for (const line of this.wrap(statement, regular, 9, 478)) {
      page.drawText(line, { x: left, y, size: 9, font: regular, color: rgb(0.28, 0.31, 0.29) });
      y -= 15;
    }
    pdf.setTitle(`${evidence.title} · Assinado`);
    return Buffer.from(await pdf.save());
  }

  private wrap(
    text: string,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    size: number,
    maxWidth: number,
  ) {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  private async throttle(
    organizationId: string,
    hashedToken: string,
    action: string,
    limit: number,
  ) {
    const keyHash = sha256(`document-signature:${hashedToken}:${action}`);
    const [counter] = await this.prisma.$queryRaw<Array<{ request_count: number }>>`
      INSERT INTO public.api_rate_limits (organization_id, key_hash, window_started_at, request_count)
      VALUES (${organizationId}::uuid, ${keyHash}, date_trunc('minute', CURRENT_TIMESTAMP), 1)
      ON CONFLICT (organization_id, key_hash) DO UPDATE SET
        window_started_at = EXCLUDED.window_started_at,
        request_count = CASE WHEN api_rate_limits.window_started_at = EXCLUDED.window_started_at
          THEN LEAST(api_rate_limits.request_count + 1, 1000000) ELSE 1 END
      RETURNING request_count`;
    if (!counter || counter.request_count > limit)
      throw new HttpException('Muitas tentativas. Aguarde um minuto e tente novamente.', 429);
  }
}
