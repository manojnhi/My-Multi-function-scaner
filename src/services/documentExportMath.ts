export type DownloadFormatId = 'pdf' | 'jpg' | 'png' | 'webp' | 'long-jpg' | 'txt';

export interface DownloadFormatOption {
  id: DownloadFormatId;
  label: string;
  ext: string;
  badge: string;
  description: string;
  recommended: boolean;
}

export interface ExportableDocMeta {
  mimeType: string;
  pageCount: number;
  pages?: string[];
  ocrText?: string;
}

export function getDefaultDownloadFormat(doc: ExportableDocMeta): DownloadFormatId {
  if (doc.mimeType === 'application/pdf' || doc.pageCount > 1) return 'pdf';
  if (doc.mimeType === 'image/png') return 'png';
  if (doc.mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function getAvailableDownloadFormats(doc: ExportableDocMeta): DownloadFormatOption[] {
  const isPdf = doc.mimeType === 'application/pdf';
  const isMultiPage = doc.pageCount > 1 || (doc.pages?.length ?? 0) > 1;
  const defaultId = getDefaultDownloadFormat(doc);

  const options: DownloadFormatOption[] = [
    {
      id: 'pdf',
      label: 'PDF Document',
      ext: 'pdf',
      badge: 'PDF',
      description: isPdf
        ? 'Original multi-page printable PDF'
        : isMultiPage
        ? `Combine ${doc.pages?.length || doc.pageCount} pages into A4 PDF`
        : 'Print-ready A4 PDF document',
      recommended: defaultId === 'pdf',
    },
    {
      id: 'jpg',
      label: 'JPG Image',
      ext: 'jpg',
      badge: 'JPG',
      description: isPdf
        ? isMultiPage
          ? 'Export each PDF page as compressed JPG'
          : 'Convert PDF page to universal JPG'
        : 'Universal small-size photo format',
      recommended: defaultId === 'jpg',
    },
    {
      id: 'png',
      label: 'PNG Image',
      ext: 'png',
      badge: 'PNG',
      description: 'Lossless crisp text, IDs & signatures',
      recommended: defaultId === 'png',
    },
    {
      id: 'webp',
      label: 'WebP Image',
      ext: 'webp',
      badge: 'WEBP',
      description: 'Modern high-clarity compact image',
      recommended: defaultId === 'webp',
    },
  ];

  if (isMultiPage) {
    options.push({
      id: 'long-jpg',
      label: 'Long Combined Image',
      ext: 'jpg',
      badge: 'LONG',
      description: 'Stitch all pages vertically into 1 JPG',
      recommended: false,
    });
  }

  if (doc.ocrText && doc.ocrText.trim().length > 0) {
    options.push({
      id: 'txt',
      label: 'Extracted Text',
      ext: 'txt',
      badge: 'TXT',
      description: 'Save scanned OCR text as plain text',
      recommended: false,
    });
  }

  return options;
}

export function buildExportFileName(
  originalFileName: string,
  ext: string,
  pageIndex?: number,
  totalPages?: number
): string {
  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
  const base = originalFileName.replace(/\.[^/.]+$/, '').trim() || 'Scanned_Document';
  if (
    typeof pageIndex === 'number' &&
    typeof totalPages === 'number' &&
    totalPages > 1
  ) {
    return `${base}_page${pageIndex + 1}.${cleanExt}`;
  }
  return `${base}.${cleanExt}`;
}
