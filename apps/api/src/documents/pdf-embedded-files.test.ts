import { AFRelationship, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfEmbeddedFiles, extractPdfScanTargets } from './pdf-embedded-files';

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function pdfWithEmbeddedFile(compressed: boolean): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([300, 144]);
  await document.attach(Buffer.from(eicar, 'ascii'), 'eicar.com', {
    mimeType: 'application/octet-stream',
    afRelationship: AFRelationship.Data,
  });

  if (!compressed) {
    const context = document.context;
    const originalFlateStream = context.flateStream;
    context.flateStream = function (contents, dictionary) {
      return this.stream(contents, dictionary);
    };
    try {
      return Buffer.from(await document.save({ useObjectStreams: false }));
    } finally {
      context.flateStream = originalFlateStream;
    }
  }

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

describe('PDF embedded file extraction for malware scanning', () => {
  it.each([false, true])('extracts exact attachment bytes (compressed=%s)', async (compressed) => {
    const files = await extractPdfEmbeddedFiles(await pdfWithEmbeddedFile(compressed));
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual(Buffer.from(eicar, 'ascii'));
  });

  it('returns no embedded files for a valid clean PDF', async () => {
    const document = await PDFDocument.create();
    document.addPage([300, 144]);
    const files = await extractPdfEmbeddedFiles(Buffer.from(await document.save()));
    expect(files).toEqual([]);
  });

  it('decodes page content streams for the application scanner', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 144]);
    page.node.addContentStream(
      document.context.register(document.context.flateStream(Buffer.from(`% ${eicar}\n`, 'ascii'))),
    );
    const targets = await extractPdfScanTargets(Buffer.from(await document.save()));
    expect(targets.pageContents).toHaveLength(1);
    expect(targets.pageContents[0]?.toString('ascii')).toContain(eicar);
    expect(targets.embeddedFiles).toEqual([]);
  });

  it('rejects a malformed PDF instead of treating it as a clean document', async () => {
    await expect(extractPdfEmbeddedFiles(Buffer.from('%PDF-invalid'))).rejects.toMatchObject({
      status: 422,
    });
  });
});
