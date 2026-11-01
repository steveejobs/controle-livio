import { UnprocessableEntityException } from '@nestjs/common';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from 'pdf-lib';

const maxEmbeddedFileCount = 64;
const maxPageContentStreamCount = 512;
const maxDecodedBytes = 4 * 1024 * 1024;
const decodeChunkBytes = 64 * 1024;

function invalidPdf(): UnprocessableEntityException {
  return new UnprocessableEntityException(
    'O PDF contém conteúdo incorporado que não pôde ser verificado.',
  );
}

function isName(value: PDFName | undefined, expected: string): boolean {
  return value?.decodeText() === expected;
}

function decodePdfStream(stream: PDFRawStream): Buffer {
  const decoded = decodePDFRawStream(stream);
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (!decoded.isEmpty) {
    const remaining = maxDecodedBytes + 1 - totalBytes;
    if (remaining <= 0) throw invalidPdf();
    const bytes = decoded.getBytes(Math.min(decodeChunkBytes, remaining));
    if (bytes.length === 0) break;
    totalBytes += bytes.length;
    if (totalBytes > maxDecodedBytes) throw invalidPdf();
    chunks.push(Buffer.from(bytes));
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * Decode bounded PDF page streams and EmbeddedFiles before scanning. ClamAV's
 * PDF handler does not decode page text and may not extract every attachment
 * filter. Malformed or unsupported streams fail closed.
 */
export async function extractPdfScanTargets(
  pdf: Buffer,
): Promise<{ pageContents: Buffer[]; embeddedFiles: Buffer[] }> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(pdf, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch {
    throw invalidPdf();
  }

  try {
    const embedded = new Set<PDFRawStream>();
    const pageContentStreams = new Set<PDFRawStream>();
    const addFileSpecification = (fileSpecification: PDFDict) => {
      if (!isName(fileSpecification.lookupMaybe(PDFName.of('Type'), PDFName), 'Filespec'))
        throw invalidPdf();
      const embeddedFiles = fileSpecification.lookupMaybe(PDFName.of('EF'), PDFDict);
      if (!embeddedFiles) throw invalidPdf();

      let linkedStreamCount = 0;
      for (const key of ['F', 'UF', 'DOS', 'Mac', 'Unix']) {
        const entryName = PDFName.of(key);
        const rawEntry = embeddedFiles.get(entryName);
        if (rawEntry === undefined) continue;
        const value = embeddedFiles.lookupMaybe(entryName, PDFStream);
        if (!(value instanceof PDFRawStream)) throw invalidPdf();
        embedded.add(value);
        linkedStreamCount += 1;
      }
      if (linkedStreamCount === 0) throw invalidPdf();
    };

    for (const page of document.getPages()) {
      const contents = page.node.Contents();
      if (contents === undefined) continue;
      const references = contents instanceof PDFArray ? contents.asArray() : [contents];
      for (const reference of references) {
        const stream = document.context.lookupMaybe(reference, PDFStream);
        if (!(stream instanceof PDFRawStream)) throw invalidPdf();
        pageContentStreams.add(stream);
      }
    }

    const catalogNames = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const embeddedFilesTree = catalogNames?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
    if (embeddedFilesTree) {
      const visitedNameTreeNodes = new Set<PDFDict>();
      const visitNameTree = (node: PDFDict) => {
        if (visitedNameTreeNodes.has(node)) return;
        visitedNameTreeNodes.add(node);
        const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
        if (names) {
          if (names.size() % 2 !== 0) throw invalidPdf();
          for (let index = 1; index < names.size(); index += 2) {
            const fileSpecification = names.lookupMaybe(index, PDFDict);
            if (!fileSpecification) throw invalidPdf();
            addFileSpecification(fileSpecification);
          }
        }
        const children = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
        if (children) {
          if (children.size() === 0) throw invalidPdf();
          for (let index = 0; index < children.size(); index += 1) {
            const child = children.lookupMaybe(index, PDFDict);
            if (!child) throw invalidPdf();
            visitNameTree(child);
          }
        }
        if (!names && !children) throw invalidPdf();
      };
      visitNameTree(embeddedFilesTree);
    }

    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream) {
        if (isName(object.dict.lookupMaybe(PDFName.of('Type'), PDFName), 'EmbeddedFile'))
          embedded.add(object);
        continue;
      }
      if (!(object instanceof PDFDict)) continue;
      if (isName(object.lookupMaybe(PDFName.of('Type'), PDFName), 'Filespec')) {
        const embeddedFiles = object.get(PDFName.of('EF'));
        if (embeddedFiles !== undefined) addFileSpecification(object);
      }
    }

    if (embedded.size > maxEmbeddedFileCount)
      throw new UnprocessableEntityException('O PDF excede o limite de anexos verificáveis.');
    if (pageContentStreams.size > maxPageContentStreamCount)
      throw new UnprocessableEntityException('O PDF excede o limite de conteúdo verificável.');

    let totalDecodedBytes = 0;
    const decodeStreams = (streams: Iterable<PDFRawStream>): Buffer[] => {
      const decodedStreams: Buffer[] = [];
      for (const stream of streams) {
        const contents = decodePdfStream(stream);
        totalDecodedBytes += contents.length;
        if (totalDecodedBytes > maxDecodedBytes) throw invalidPdf();
        decodedStreams.push(contents);
      }
      return decodedStreams;
    };

    return {
      pageContents: decodeStreams(pageContentStreams),
      embeddedFiles: decodeStreams(embedded),
    };
  } catch (error) {
    if (error instanceof UnprocessableEntityException) throw error;
    throw invalidPdf();
  }
}

export async function extractPdfEmbeddedFiles(pdf: Buffer): Promise<Buffer[]> {
  return (await extractPdfScanTargets(pdf)).embeddedFiles;
}
