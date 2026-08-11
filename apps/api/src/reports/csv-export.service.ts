import { Injectable } from '@nestjs/common';

export interface ReportExporter {
  exportCsv(rows: Record<string, unknown>[]): string;
  exportPdf(rows: Record<string, unknown>[]): Promise<Buffer>;
}

@Injectable()
export class CsvExportService implements ReportExporter {
  exportCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '\uFEFF';
    const headers = Object.keys(rows[0]!);
    const lines = [headers.map((header) => this.cell(header)).join(',')];
    for (const row of rows) lines.push(headers.map((header) => this.cell(row[header])).join(','));
    return `\uFEFF${lines.join('\r\n')}`;
  }

  exportPdf(rows: Record<string, unknown>[]): Promise<Buffer> {
    void rows;
    return Promise.reject(new Error('Exportador PDF não configurado nesta versão'));
  }

  private cell(value: unknown): string {
    let text =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
}
