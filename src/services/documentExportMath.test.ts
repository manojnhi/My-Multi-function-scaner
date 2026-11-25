import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportFileName,
  getAvailableDownloadFormats,
  getDefaultDownloadFormat,
} from './documentExportMath';

test('getDefaultDownloadFormat picks matching native or PDF default', () => {
  assert.equal(getDefaultDownloadFormat({ mimeType: 'application/pdf', pageCount: 1 }), 'pdf');
  assert.equal(getDefaultDownloadFormat({ mimeType: 'image/jpeg', pageCount: 3 }), 'pdf');
  assert.equal(getDefaultDownloadFormat({ mimeType: 'image/png', pageCount: 1 }), 'png');
  assert.equal(getDefaultDownloadFormat({ mimeType: 'image/webp', pageCount: 1 }), 'webp');
  assert.equal(getDefaultDownloadFormat({ mimeType: 'image/jpeg', pageCount: 1 }), 'jpg');
});

test('getAvailableDownloadFormats includes core formats plus multi-page and OCR text when present', () => {
  const singleNoOcr = getAvailableDownloadFormats({
    mimeType: 'image/jpeg',
    pageCount: 1,
    ocrText: '',
  });
  assert.deepEqual(
    singleNoOcr.map((o) => o.id),
    ['pdf', 'jpg', 'png', 'webp']
  );

  const multiWithOcr = getAvailableDownloadFormats({
    mimeType: 'application/pdf',
    pageCount: 3,
    ocrText: 'Sample OCR text',
  });
  assert.deepEqual(
    multiWithOcr.map((o) => o.id),
    ['pdf', 'jpg', 'png', 'webp', 'long-jpg', 'txt']
  );
  assert.equal(multiWithOcr.find((o) => o.id === 'pdf')?.recommended, true);
});

test('buildExportFileName replaces extension cleanly and appends page index for multi-page exports', () => {
  assert.equal(buildExportFileName('Invoice_2026.jpg', 'pdf'), 'Invoice_2026.pdf');
  assert.equal(buildExportFileName('Contract.pdf', 'png', 1, 4), 'Contract_page2.png');
  assert.equal(buildExportFileName('Note', '.TXT'), 'Note.txt');
});
