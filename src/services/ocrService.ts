import { createWorker } from 'tesseract.js';
import type { OcrLanguage } from '../types';

export interface OcrResult {
  text: string;
  confidence: number;
  language: OcrLanguage;
}

export async function runOcrExtraction(
  imageDataUrl: string,
  language: OcrLanguage = 'eng+hin',
  onProgress?: (progressPct: number, statusText: string) => void
): Promise<OcrResult> {
  onProgress?.(5, 'Initializing OCR engine...');

  const worker = await createWorker(language, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(25 + m.progress * 70), 'Recognizing text...');
      } else if (m.status) {
        onProgress?.(15, m.status);
      }
    },
  });

  try {
    onProgress?.(20, `Running ${language.toUpperCase()} recognition...`);
    const result = await worker.recognize(imageDataUrl);
    onProgress?.(100, 'Complete');
    return {
      text: (result.data.text || '').trim(),
      confidence: Math.round(result.data.confidence || 0),
      language,
    };
  } finally {
    await worker.terminate();
  }
}

export function downloadTextFile(text: string, baseFileName: string): void {
  const cleanBase = baseFileName.replace(/\.[^.]+$/, '');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanBase}_OCR.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
