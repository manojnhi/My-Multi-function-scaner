import type { ScanDocument } from '../types';
import {
  buildExportFileName,
  type DownloadFormatId,
} from './documentExportMath';
import { composeLongImage, getDataUrlByteLength, loadImageElement } from './imageProcessor';
import { downloadDataUrl, imagesToPdf, pdfToImages } from './pdfService';

async function transcodeImageDataUrl(
  srcDataUrl: string,
  targetMime: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number
): Promise<string> {
  if (srcDataUrl.startsWith(`data:${targetMime}`) && quality >= 0.94 && targetMime === 'image/png') {
    return srcDataUrl;
  }
  const img = await loadImageElement(srcDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL(targetMime, quality);
}

async function resolveSourcePageImages(doc: ScanDocument, quality: number): Promise<string[]> {
  if (doc.mimeType === 'application/pdf') {
    const pages = await pdfToImages(doc.dataUrl, 1.8, Math.max(0.85, quality));
    if (pages.length === 0) throw new Error('Could not render PDF pages for export.');
    return pages;
  }
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages;
  }
  return [doc.dataUrl];
}

export async function exportDocumentInFormat(
  doc: ScanDocument,
  format: DownloadFormatId,
  quality = 0.9
): Promise<{ exportedFiles: string[]; totalBytes: number }> {
  const baseName = doc.fileName || doc.title;

  if (format === 'txt') {
    const content = doc.ocrText?.trim();
    if (!content) {
      throw new Error('No extracted OCR text available for this document.');
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const outName = buildExportFileName(baseName, 'txt');
    downloadDataUrl(url, outName);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { exportedFiles: [outName], totalBytes: blob.size };
  }

  if (format === 'pdf') {
    const outName = buildExportFileName(baseName, 'pdf');
    if (doc.mimeType === 'application/pdf') {
      downloadDataUrl(doc.dataUrl, outName);
      return { exportedFiles: [outName], totalBytes: doc.sizeBytes || getDataUrlByteLength(doc.dataUrl) };
    }
    const pages = doc.pages && doc.pages.length > 0 ? doc.pages : [doc.dataUrl];
    const pdf = await imagesToPdf(pages, {
      paperSize: 'A4',
      orientation: 'portrait',
      marginPt: 18,
      quality,
    });
    downloadDataUrl(pdf.dataUrl, outName);
    return { exportedFiles: [outName], totalBytes: pdf.sizeBytes };
  }

  if (format === 'long-jpg') {
    const pages = await resolveSourcePageImages(doc, quality);
    const stitched = await composeLongImage(pages, quality);
    const base = baseName.replace(/\.[^/.]+$/, '').trim() || 'Scanned_Document';
    const outName = `${base}_long.jpg`;
    downloadDataUrl(stitched.dataUrl, outName);
    return { exportedFiles: [outName], totalBytes: stitched.sizeBytes };
  }

  const targetMime: 'image/jpeg' | 'image/png' | 'image/webp' =
    format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const ext = format;

  const pageImages = await resolveSourcePageImages(doc, quality);
  const exportedFiles: string[] = [];
  let totalBytes = 0;

  for (let i = 0; i < pageImages.length; i++) {
    const encoded = await transcodeImageDataUrl(pageImages[i], targetMime, quality);
    const outName = buildExportFileName(baseName, ext, i, pageImages.length);
    downloadDataUrl(encoded, outName);
    exportedFiles.push(outName);
    totalBytes += getDataUrlByteLength(encoded);
  }

  return { exportedFiles, totalBytes };
}
