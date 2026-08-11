import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { CsvExportService } from './csv-export.service';
import { ReportsService } from './reports.service';

const actor: AuthenticatedActor = {
  userId: 'user',
  sessionId: 'session',
  organizationId: 'org-report',
  permissions: [],
};

describe('relatórios e exportação', () => {
  it('separa base de caixa e filtra contratos pelo tenant', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ReportsService({ contract: { findMany } } as never);
    await expect(service.activeContracts(actor)).resolves.toEqual({
      basis: 'estado_contratual',
      rows: [],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-report', status: 'ACTIVE' } }),
    );
  });

  it('neutraliza fórmulas e preserva CSV válido', () => {
    const csv = new CsvExportService().exportCsv([
      { nome: '=HYPERLINK("https://invalid")', valor: '-10', seguro: 'texto, normal' },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'-10");
    expect(csv).toContain('"texto, normal"');
  });
});
