import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { interpretReceiptText, type ReceiptFields } from './receipt-interpretation';

const requireFromHere = createRequire(__filename);
const languagePath = dirname(
  requireFromHere.resolve('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz'),
);
const maximumPages = 3;
const maximumPixels = 4_000_000;

@Injectable()
export class ReceiptExtractionService {
  private active = 0;

  async extract(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{
    fields: ReceiptFields;
    warnings: string[];
    method: 'PDF_TEXT' | 'OCR';
  }> {
    if (this.active >= 2)
      throw new ServiceUnavailableException('Leitura ocupada; tente novamente em instantes.');
    this.active += 1;
    try {
      if (mimeType === 'application/pdf') return await this.extractPdf(buffer);
      if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
        const image = await loadImage(buffer);
        if (image.width * image.height > maximumPixels)
          throw new UnprocessableEntityException('Imagem excede o limite seguro para OCR.');
        const first = interpretReceiptText(await this.ocr(buffer), 'OCR');
        if (first.fields.paidAmount && first.fields.paidDate) return { ...first, method: 'OCR' };
        for (const angle of [90, 270] as const) {
          const rotated = createCanvas(image.height, image.width);
          const context = rotated.getContext('2d');
          context.translate(angle === 90 ? image.height : 0, angle === 270 ? image.width : 0);
          context.rotate((angle * Math.PI) / 180);
          context.drawImage(image, 0, 0);
          const result = interpretReceiptText(await this.ocr(rotated.toBuffer('image/png')), 'OCR');
          if (result.fields.paidAmount && result.fields.paidDate)
            return { ...result, method: 'OCR' };
        }
        return { ...first, method: 'OCR' };
      }
      throw new UnprocessableEntityException('Comprovante deve ser PDF, JPG ou PNG.');
    } finally {
      this.active -= 1;
    }
  }

  private async extractPdf(buffer: Buffer) {
    // PDF.js keeps its parser in ESM; Node's require(ESM) is supported by the required Node 22+ runtime.
    const pdfjs = requireFromHere(
      'pdfjs-dist/legacy/build/pdf.mjs',
    ) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    let document: Awaited<typeof task.promise> | undefined;
    try {
      document = await task.promise;
      if (document.numPages > maximumPages)
        throw new UnprocessableEntityException(`Comprovante excede ${maximumPages} páginas.`);
      const textPages: string[] = [];
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const content = await page.getTextContent();
        let previousY: number | undefined;
        let pageText = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform[5];
          pageText += previousY !== undefined && Math.abs(y - previousY) > 2 ? '\n' : ' ';
          pageText += item.str;
          previousY = y;
        }
        textPages.push(pageText);
      }
      const native = interpretReceiptText(textPages.join('\n'), 'PDF_TEXT');
      if (native.fields.paidAmount && native.fields.paidDate)
        return { ...native, method: 'PDF_TEXT' as const };
      const ocrPages: string[] = [];
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const viewport = page.getViewport({ scale: 1.6 });
        if (viewport.width * viewport.height > maximumPixels)
          throw new UnprocessableEntityException('Página excede o limite seguro para OCR.');
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvasContext: canvas.getContext('2d') as never,
          canvas: canvas as never,
          viewport,
        }).promise;
        ocrPages.push(await this.ocr(canvas.toBuffer('image/png')));
      }
      const optical = interpretReceiptText(ocrPages.join('\n'), 'OCR');
      return { ...optical, method: 'OCR' as const };
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new UnprocessableEntityException('PDF não pôde ser interpretado com segurança.');
    } finally {
      await task.destroy();
    }
  }

  private async ocr(buffer: Buffer): Promise<string> {
    const worker = await createWorker('por', 1, {
      langPath: languagePath,
      gzip: true,
      cacheMethod: 'none',
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        worker.recognize(buffer),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ServiceUnavailableException('A leitura do comprovante excedeu o tempo seguro.'),
              ),
            15_000,
          );
        }),
      ]);
      return result.data.text.slice(0, 40_000);
    } finally {
      if (timer) clearTimeout(timer);
      await worker.terminate();
    }
  }
}
