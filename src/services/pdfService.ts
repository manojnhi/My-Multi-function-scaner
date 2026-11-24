import { degrees, PageSizes, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentFilterMode, PaperSize } from '../types';
import { cleanImageDocument, loadImageElement } from './imageProcessor';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PdfBuildOptions {
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  marginPt: number;
  quality: number; // 0.5 .. 1.0
  customWidthPt?: number;
  customHeightPt?: number;
}

export const DEFAULT_PDF_OPTIONS: PdfBuildOptions = {
  paperSize: 'A4',
  orientation: 'portrait',
  marginPt: 24,
  quality: 0.88,
};

function getPageDimensions(opts: PdfBuildOptions): [number, number] {
  let base: [number, number] = PageSizes.A4;
  switch (opts.paperSize) {
    case 'A3':
      base = PageSizes.A3;
      break;
    case 'Letter':
      base = PageSizes.Letter;
      break;
    case 'Legal':
      base = PageSizes.Legal;
      break;
    case 'Custom':
      base = [opts.customWidthPt || 595, opts.customHeightPt || 842];
      break;
    case 'A4':
    default:
      base = PageSizes.A4;
  }
  return opts.orientation === 'landscape' ? [base[1], base[0]] : base;
}

async function dataUrlToJpegBytes(dataUrl: string, quality: number): Promise<Uint8Array> {
  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const jpegUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = jpegUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function pdfBytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function imagesToPdf(
  imageDataUrls: string[],
  options: PdfBuildOptions = DEFAULT_PDF_OPTIONS
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const pdfDoc = await PDFDocument.create();
  const [pageW, pageH] = getPageDimensions(options);
  const usableW = Math.max(50, pageW - options.marginPt * 2);
  const usableH = Math.max(50, pageH - options.marginPt * 2);

  for (const imgUrl of imageDataUrls) {
    const jpegBytes = await dataUrlToJpegBytes(imgUrl, options.quality);
    const embedded = await pdfDoc.embedJpg(jpegBytes);
    const page = pdfDoc.addPage([pageW, pageH]);
    const scale = Math.min(usableW / embedded.width, usableH / embedded.height);
    const drawW = embedded.width * scale;
    const drawH = embedded.height * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
  }

  const saved = await pdfDoc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: pdfDoc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function idCardToSinglePdf(
  frontDataUrl: string,
  backDataUrl: string | null,
  quality = 0.9
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const pdfDoc = await PDFDocument.create();
  const [pageW, pageH] = PageSizes.A4;
  const page = pdfDoc.addPage([pageW, pageH]);

  const cardMaxW = 300;
  const cardMaxH = 195;

  const frontBytes = await dataUrlToJpegBytes(frontDataUrl, quality);
  const frontImg = await pdfDoc.embedJpg(frontBytes);
  const fScale = Math.min(cardMaxW / frontImg.width, cardMaxH / frontImg.height);
  const fw = frontImg.width * fScale;
  const fh = frontImg.height * fScale;
  const fx = (pageW - fw) / 2;
  const fy = pageH - 120 - fh;

  page.drawRectangle({
    x: fx - 6,
    y: fy - 6,
    width: fw + 12,
    height: fh + 12,
    borderColor: rgb(0.8, 0.84, 0.88),
    borderWidth: 1,
  });
  page.drawImage(frontImg, { x: fx, y: fy, width: fw, height: fh });

  if (backDataUrl) {
    const backBytes = await dataUrlToJpegBytes(backDataUrl, quality);
    const backImg = await pdfDoc.embedJpg(backBytes);
    const bScale = Math.min(cardMaxW / backImg.width, cardMaxH / backImg.height);
    const bw = backImg.width * bScale;
    const bh = backImg.height * bScale;
    const bx = (pageW - bw) / 2;
    const by = fy - 48 - bh;

    page.drawRectangle({
      x: bx - 6,
      y: by - 6,
      width: bw + 12,
      height: bh + 12,
      borderColor: rgb(0.8, 0.84, 0.88),
      borderWidth: 1,
    });
    page.drawImage(backImg, { x: bx, y: by, width: bw, height: bh });
  }

  const saved = await pdfDoc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: 1,
    sizeBytes: saved.byteLength,
  };
}

export async function mergePdfs(
  pdfDataUrls: string[]
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const merged = await PDFDocument.create();
  for (const url of pdfDataUrls) {
    const src = await PDFDocument.load(dataUrlToBytes(url));
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const page of copied) merged.addPage(page);
  }
  const saved = await merged.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: merged.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function extractPdfPages(
  pdfDataUrl: string,
  zeroBasedIndices: number[]
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const src = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const total = src.getPageCount();
  const valid = zeroBasedIndices.filter((i) => i >= 0 && i < total);
  if (valid.length === 0) throw new Error('Select at least one valid page.');

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, valid);
  for (const page of copied) out.addPage(page);
  const saved = await out.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: out.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function rotatePdfAllOrSelected(
  pdfDataUrl: string,
  angleDeg: 90 | 180 | 270,
  targetPageIndices?: number[]
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    if (!targetPageIndices || targetPageIndices.includes(idx)) {
      const current = p.getRotation().angle;
      p.setRotation(degrees((current + angleDeg) % 360));
    }
  });
  const saved = await doc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: doc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function pdfToImages(
  pdfDataUrl: string,
  scale = 1.6,
  quality = 0.85
): Promise<string[]> {
  const bytes = dataUrlToBytes(pdfDataUrl);
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    images.push(canvas.toDataURL('image/jpeg', quality));
  }

  return images;
}

export async function compressPdfViaRasterize(
  pdfDataUrl: string,
  quality = 0.62
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const pageImages = await pdfToImages(pdfDataUrl, 1.3, quality);
  return imagesToPdf(pageImages, {
    paperSize: 'A4',
    orientation: 'portrait',
    marginPt: 12,
    quality,
  });
}

export async function getPdfPageCount(pdfDataUrl: string): Promise<number> {
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  return doc.getPageCount();
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function rebuildPdfPages(
  pdfDataUrl: string,
  pagePlan: Array<{ zeroBasedIndex: number; rotationDelta: 0 | 90 | 180 | 270 }>
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  if (pagePlan.length === 0) throw new Error('At least one page must remain.');
  const src = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    pagePlan.map((p) => p.zeroBasedIndex)
  );
  copied.forEach((page, i) => {
    const delta = pagePlan[i].rotationDelta;
    if (delta !== 0) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + delta) % 360));
    }
    out.addPage(page);
  });
  const saved = await out.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: out.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function addWatermarkToPdf(
  pdfDataUrl: string,
  watermarkText: string,
  options: { opacity?: number; fontSize?: number; diagonal?: boolean } = {}
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = watermarkText.trim() || 'CONFIDENTIAL';
  const opacity = options.opacity ?? 0.22;
  const fontSize = options.fontSize ?? 42;
  const diagonal = options.diagonal ?? true;

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: diagonal ? Math.max(24, (width - textWidth * 0.7) / 2) : (width - textWidth) / 2,
      y: diagonal ? height * 0.42 : 28,
      size: fontSize,
      font,
      color: rgb(0.02, 0.31, 0.23),
      opacity,
      rotate: diagonal ? degrees(35) : degrees(0),
    });
  }

  const saved = await doc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: doc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptDocumentVault(
  payload: { title: string; fileName: string; mimeType: string; dataUrl: string },
  password: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  const envelope = {
    format: 'MFSCANNER_AES256_VAULT_V1',
    salt: Array.from(salt),
    iv: Array.from(iv),
    cipher: Array.from(new Uint8Array(cipherBuffer)),
  };
  return JSON.stringify(envelope);
}

export async function decryptDocumentVault(
  vaultJson: string,
  password: string
): Promise<{ title: string; fileName: string; mimeType: string; dataUrl: string }> {
  const parsed = JSON.parse(vaultJson) as {
    format: string;
    salt: number[];
    iv: number[];
    cipher: number[];
  };
  if (parsed.format !== 'MFSCANNER_AES256_VAULT_V1') {
    throw new Error('Unsupported encrypted vault format.');
  }
  const salt = new Uint8Array(parsed.salt);
  const iv = new Uint8Array(parsed.iv);
  const cipher = new Uint8Array(parsed.cipher);
  const key = await deriveAesKey(password, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

export interface PdfTextAnnotation {
  id: string;
  pageIndex: number; // 0-based
  text: string;
  xPct: number; // 0 .. 1 from left
  yPct: number; // 0 .. 1 from top
  fontSize: number;
  colorHex: string;
  bold?: boolean;
  whiteoutBg?: boolean;
  whiteoutWidthPct?: number;
}

export interface ExtractedPdfTextSpan {
  id: string;
  pageIndex: number;
  text: string;
  xPct: number;
  yPct: number;
  fontSize: number;
  widthPct: number;
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  if (Number.isNaN(num)) return rgb(0.06, 0.09, 0.16);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

export async function extractPdfTextItems(pdfDataUrl: string): Promise<ExtractedPdfTextSpan[]> {
  const bytes = dataUrlToBytes(pdfDataUrl);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const spans: ExtractedPdfTextSpan[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = item.transform;
      const x = tx[4];
      const yFromBottom = tx[5];
      const fontSize = Math.max(8, Math.min(48, Math.round(Math.hypot(tx[0], tx[1]) || 12)));
      const yFromTop = viewport.height - yFromBottom - fontSize * 0.85;
      spans.push({
        id: `${p - 1}-${spans.length}`,
        pageIndex: p - 1,
        text: item.str,
        xPct: Math.max(0.02, Math.min(0.92, x / viewport.width)),
        yPct: Math.max(0.02, Math.min(0.95, yFromTop / viewport.height)),
        fontSize,
        widthPct: Math.max(0.08, Math.min(0.85, (item.width || 60) / viewport.width)),
      });
    }
  }
  return spans;
}

export async function applyPdfTextEdits(
  pdfDataUrl: string,
  edits: PdfTextAnnotation[]
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const edit of edits) {
    const page = pages[edit.pageIndex];
    if (!page || !edit.text.trim()) continue;
    const { width, height } = page.getSize();
    const font = edit.bold ? fontBold : fontRegular;
    const x = Math.max(8, Math.min(width - 24, edit.xPct * width));
    const yTop = Math.max(12, Math.min(height - 12, edit.yPct * height));
    const yPdf = height - yTop - edit.fontSize * 0.82;

    if (edit.whiteoutBg) {
      const boxW = Math.max(
        font.widthOfTextAtSize(edit.text, edit.fontSize) + 10,
        (edit.whiteoutWidthPct || 0.22) * width
      );
      page.drawRectangle({
        x: x - 3,
        y: yPdf - 3,
        width: boxW,
        height: edit.fontSize + 7,
        color: rgb(1, 1, 1),
      });
    }

    page.drawText(edit.text, {
      x,
      y: yPdf,
      size: edit.fontSize,
      font,
      color: hexToRgb(edit.colorHex),
    });
  }

  const saved = await doc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: doc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function cleanPdfDocument(
  pdfDataUrl: string,
  options: { cleanStrength?: number; mode?: DocumentFilterMode; quality?: number } = {}
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const cleanStrength = options.cleanStrength ?? 82;
  const mode = options.mode ?? 'color';
  const quality = options.quality ?? 0.84;

  const rawImages = await pdfToImages(pdfDataUrl, 1.55, 0.92);
  const cleanedImages: string[] = [];
  for (const img of rawImages) {
    const cleaned = await cleanImageDocument(img, cleanStrength, mode, quality);
    cleanedImages.push(cleaned.dataUrl);
  }
  return imagesToPdf(cleanedImages, {
    paperSize: 'A4',
    orientation: 'portrait',
    marginPt: 10,
    quality,
  });
}

export async function protectPdfWithPassword(
  pdfDataUrl: string,
  userPassword: string,
  ownerPassword?: string
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  if (!userPassword || userPassword.length < 3) {
    throw new Error('Password must be at least 3 characters.');
  }
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  await doc.encrypt({
    userPassword,
    ownerPassword: ownerPassword && ownerPassword.trim() ? ownerPassword.trim() : userPassword,
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false,
    },
  });
  const saved = await doc.save({ useObjectStreams: false });
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: doc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function checkPdfNeedsPassword(pdfDataUrl: string): Promise<boolean> {
  try {
    await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    return msg.includes('encrypt') || msg.includes('password');
  }
}

export async function removePdfPassword(
  pdfDataUrl: string,
  password: string
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const bytes = dataUrlToBytes(pdfDataUrl);
  try {
    const doc = await PDFDocument.load(bytes, { password });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(doc, doc.getPageIndices());
    for (const p of copied) out.addPage(p);
    const saved = await out.save();
    return {
      dataUrl: pdfBytesToDataUrl(saved),
      pageCount: out.getPageCount(),
      sizeBytes: saved.byteLength,
    };
  } catch {
    // Fallback via pdfjs-dist (handles AES-256 V5 encrypted PDFs too)
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes, password }).promise;
      const imgs: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        imgs.push(canvas.toDataURL('image/jpeg', 0.9));
      }
      return imagesToPdf(imgs, {
        paperSize: 'A4',
        orientation: 'portrait',
        marginPt: 8,
        quality: 0.9,
      });
    } catch {
      throw new Error('Incorrect PDF password or unsupported PDF file.');
    }
  }
}

export async function cropPdfPages(
  pdfDataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  targetPageIndices?: number[]
): Promise<{ dataUrl: string; pageCount: number; sizeBytes: number }> {
  const doc = await PDFDocument.load(dataUrlToBytes(pdfDataUrl));
  const pages = doc.getPages();
  const rx = Math.max(0, Math.min(0.95, rect.x));
  const ry = Math.max(0, Math.min(0.95, rect.y));
  const rw = Math.max(0.04, Math.min(1 - rx, rect.width));
  const rh = Math.max(0.04, Math.min(1 - ry, rect.height));

  pages.forEach((page, idx) => {
    if (targetPageIndices && !targetPageIndices.includes(idx)) return;
    const box = page.getCropBox();
    const bx = box.x ?? 0;
    const by = box.y ?? 0;
    const bw = box.width;
    const bh = box.height;

    const cropW = Math.max(24, rw * bw);
    const cropH = Math.max(24, rh * bh);
    const cropX = bx + rx * bw;
    const cropY = by + (1 - ry - rh) * bh;

    page.setCropBox(cropX, cropY, cropW, cropH);
    page.setMediaBox(cropX, cropY, cropW, cropH);
  });

  const saved = await doc.save();
  return {
    dataUrl: pdfBytesToDataUrl(saved),
    pageCount: doc.getPageCount(),
    sizeBytes: saved.byteLength,
  };
}

export async function resizePdfToManualSize(
  pdfDataUrl: string,
  targetBytes: number
): Promise<{
  dataUrl: string;
  pageCount: number;
  sizeBytes: number;
  achievedTarget: boolean;
}> {
  const origBytes = dataUrlToBytes(pdfDataUrl);
  if (origBytes.byteLength <= targetBytes) {
    const doc = await PDFDocument.load(origBytes);
    return {
      dataUrl: pdfDataUrl,
      pageCount: doc.getPageCount(),
      sizeBytes: origBytes.byteLength,
      achievedTarget: true,
    };
  }

  const tiers = [
    { scale: 1.45, q: 0.82 },
    { scale: 1.3, q: 0.68 },
    { scale: 1.15, q: 0.54 },
    { scale: 0.95, q: 0.42 },
    { scale: 0.78, q: 0.32 },
    { scale: 0.6, q: 0.24 },
  ];

  let smallest: { dataUrl: string; pageCount: number; sizeBytes: number } | null = null;

  for (const tier of tiers) {
    const imgs = await pdfToImages(pdfDataUrl, tier.scale, tier.q);
    const candidate = await imagesToPdf(imgs, {
      paperSize: 'A4',
      orientation: 'portrait',
      marginPt: 8,
      quality: tier.q,
    });
    if (!smallest || candidate.sizeBytes < smallest.sizeBytes) {
      smallest = candidate;
    }
    if (candidate.sizeBytes <= targetBytes) {
      return { ...candidate, achievedTarget: true };
    }
  }

  if (!smallest) {
    throw new Error('Could not resize PDF.');
  }
  return {
    ...smallest,
    achievedTarget: smallest.sizeBytes <= targetBytes,
  };
}



