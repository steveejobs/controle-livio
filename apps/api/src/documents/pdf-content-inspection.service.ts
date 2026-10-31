import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';

const requireFromHere = createRequire(__filename);
const languagePath = dirname(
  requireFromHere.resolve('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz'),
);
const maximumPdfPages = 64;
const maximumOcrPages = 16;
const maximumPagePixels = 4_000_000;
const maximumTotalOcrPixels = 24_000_000;
const maximumExtractedTextBytes = 4 * 1024 * 1024;
const inspectionTimeoutMs = 30_000;

type InspectionResult = {
  text: Buffer;
  ocrText: Buffer;
  pageCount: number;
  ocrPageCount: number;
};

@Injectable()
export class PdfContentInspectionService {
  protected createOcrWorker() {
    return createWorker('por', 1, {
      langPath: languagePath,
      gzip: true,
      cacheMethod: 'none',
    });
  }

  async inspect(pdf: Buffer): Promise<InspectionResult> {
    const pdfjs = requireFromHere(
      'pdfjs-dist/legacy/build/pdf.mjs',
    ) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({
      data: new Uint8Array(pdf),
      useSystemFonts: true,
      maxImageSize: maximumPagePixels,
      enableXfa: false,
      stopAtErrors: true,
    });
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;

    const operation = async (): Promise<InspectionResult> => {
      const document = await task.promise;
      if (document.numPages > maximumPdfPages)
        throw new UnprocessableEntityException('PDF excede o limite seguro de inspeção.');

      const textPages: string[] = [];
      const ocrTextPages: string[] = [];
      let extractedBytes = 0;
      const appendExtractedText = (text: string, target: string[]) => {
        if (!text) return;
        const separatorBytes = textPages.length > 0 ? Buffer.byteLength('\n', 'utf8') : 0;
        const textBytes = Buffer.byteLength(text, 'utf8');
        if (extractedBytes + separatorBytes + textBytes > maximumExtractedTextBytes)
          throw new UnprocessableEntityException(
            'Texto extraído excede o limite seguro de inspeção.',
          );
        extractedBytes += separatorBytes + textBytes;
        target.push(text);
      };
      let ocrPages = 0;
      let totalOcrPixels = 0;
      const imageOperations = new Set([
        pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.paintImageMaskXObjectGroup,
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintInlineImageXObjectGroup,
        pdfjs.OPS.paintImageXObjectRepeat,
        pdfjs.OPS.paintImageMaskXObjectRepeat,
        pdfjs.OPS.paintSolidColorImageMask,
      ]);

      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        try {
          const content = await page.getTextContent();
          const nativeText = content.items
            .filter((item): item is typeof item & { str: string } => 'str' in item)
            .map((item) => item.str)
            .join('');
          appendExtractedText(nativeText, textPages);

          const operators = await page.getOperatorList();
          const containsImage = operators.fnArray.some((operator) => imageOperations.has(operator));
          if (!containsImage) continue;
          if (ocrPages >= maximumOcrPages)
            throw new UnprocessableEntityException('PDF excede o limite seguro de páginas OCR.');

          const viewport = page.getViewport({ scale: 1 });
          const pixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
          if (
            !Number.isSafeInteger(pixels) ||
            pixels < 1 ||
            pixels > maximumPagePixels ||
            totalOcrPixels + pixels > maximumTotalOcrPixels
          )
            throw new UnprocessableEntityException('Página excede o limite seguro para OCR.');
          totalOcrPixels += pixels;

          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({
            canvasContext: canvas.getContext('2d') as never,
            canvas: canvas as never,
            viewport,
          }).promise;
          let recognizedText: string;
          try {
            worker ??= await this.createOcrWorker();
            if (timedOut) {
              await worker.terminate();
              worker = undefined;
              throw new ServiceUnavailableException('A inspeção do PDF excedeu o tempo seguro.');
            }
            const recognized = await worker.recognize(canvas.toBuffer('image/png'));
            recognizedText = recognized.data.text;
          } catch (error) {
            if (error instanceof ServiceUnavailableException) throw error;
            throw new ServiceUnavailableException('A inspeção OCR do PDF não pôde ser concluída.');
          }
          appendExtractedText(recognizedText, textPages);
          if (recognizedText) ocrTextPages.push(recognizedText);
          ocrPages += 1;
        } finally {
          page.cleanup();
        }
      }

      return {
        text: Buffer.from(textPages.join('\n'), 'utf8'),
        ocrText: Buffer.from(ocrTextPages.join('\n'), 'utf8'),
        pageCount: document.numPages,
        ocrPageCount: ocrPages,
      };
    };

    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new ServiceUnavailableException('A inspeção do PDF excedeu o tempo seguro.'));
          }, inspectionTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new UnprocessableEntityException('PDF não pôde ser inspecionado com segurança.');
    } finally {
      if (timeout) clearTimeout(timeout);
      await Promise.allSettled([task.destroy(), worker?.terminate() ?? Promise.resolve()]);
    }
  }
}
