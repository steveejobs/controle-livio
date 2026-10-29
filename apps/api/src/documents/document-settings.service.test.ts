import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSettingsService } from './document-settings.service';
import { DEFAULT_DOCUMENT_TEMPLATES } from './document-templates';

const administrator: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: ['organization:view', 'organization:update'],
  isAdministrator: true,
};

const input = {
  attorneyName: 'Dra. Ana Advogada',
  professionalRegistration: 'OAB/MA 12345',
  officeAddress: 'Rua Central, 10, Centro, Balsas/MA',
  jurisdiction: 'Balsas/MA',
  paymentInstructions: 'PIX institucional',
};

describe('DocumentSettingsService', () => {
  it('preserva outras configurações da organização e audita sem gravar dados bancários', async () => {
    const organization = {
      settings: { accessAlerts: { enabled: true }, legalDocuments: null },
    };
    const update = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(organization),
        update,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentSettingsService(prisma as never, audit as never);

    await expect(service.update(administrator, input)).resolves.toEqual({
      configured: true,
      settings: input,
    });
    expect(update.mock.calls[0]![0].data.settings).toMatchObject({
      accessAlerts: { enabled: true },
      legalDocuments: input,
    });
    expect(audit.record.mock.calls[0]![1]).toMatchObject({
      resource: 'organization.document_settings',
      before: { configured: false },
      after: { configured: true },
    });
    expect(JSON.stringify(audit.record.mock.calls[0]![1])).not.toContain('PIX institucional');
  });

  it('restringe a leitura das informações profissionais a administradores', async () => {
    const service = new DocumentSettingsService({} as never, {} as never);
    await expect(service.get({ ...administrator, isAdministrator: false })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('salva e restaura modelos sem sobrescrever dados profissionais nem auditar o texto', async () => {
    let settings: Record<string, unknown> = {
      accessAlerts: { enabled: true },
      legalDocuments: { ...input, templates: {} },
    };
    const organization = {
      findUniqueOrThrow: vi.fn(async () => ({ settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        settings = data.settings;
      }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      organization,
    };
    const prisma = {
      organization,
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentSettingsService(prisma as never, audit as never);
    const content = DEFAULT_DOCUMENT_TEMPLATES.HIPOSSUFICIENCIA.replace(
      'A presente declaração é emitida',
      'Texto da organização. A presente declaração é emitida',
    );

    const saved = await service.updateTemplate(administrator, {
      category: 'HIPOSSUFICIENCIA',
      content,
    });
    expect(
      saved.templates.find((template) => template.category === 'HIPOSSUFICIENCIA'),
    ).toMatchObject({ content, customized: true });
    expect(settings).toMatchObject({
      accessAlerts: { enabled: true },
      legalDocuments: {
        attorneyName: input.attorneyName,
        templates: { HIPOSSUFICIENCIA: content },
      },
    });
    expect(JSON.stringify(audit.record.mock.calls[0]![1])).not.toContain('Texto da organização');

    const restored = await service.resetTemplate(administrator, 'HIPOSSUFICIENCIA');
    expect(
      restored.templates.find((template) => template.category === 'HIPOSSUFICIENCIA'),
    ).toMatchObject({ content: DEFAULT_DOCUMENT_TEMPLATES.HIPOSSUFICIENCIA, customized: false });
    expect(settings).toMatchObject({ legalDocuments: { attorneyName: input.attorneyName } });
  });
});
