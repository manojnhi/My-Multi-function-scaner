import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFolderEntries,
  countDocsInFolder,
  createFolderInPrefs,
  deleteFolderFromPrefs,
  EMPTY_FOLDER_PREFS,
  renameFolderInPrefs,
} from './folderMath';
import type { ScanDocument } from '../types';

test('buildFolderEntries returns defaults with renamed labels and hides deleted defaults', () => {
  let prefs = createFolderInPrefs(EMPTY_FOLDER_PREFS, 'Tax Invoices').nextPrefs;
  prefs = renameFolderInPrefs(prefs, 'Scans', 'Daily Scans');
  prefs = deleteFolderFromPrefs(prefs, 'PDFs');

  const list = buildFolderEntries(prefs);
  assert.deepEqual(
    list.map((f) => f.label),
    ['Daily Scans', 'ID Cards', 'Receipts', 'Tax Invoices']
  );
});

test('renameFolderInPrefs and deleteFolderFromPrefs work for custom folders without touching others', () => {
  let prefs = createFolderInPrefs(EMPTY_FOLDER_PREFS, 'Office Bills').nextPrefs;
  prefs = renameFolderInPrefs(prefs, 'Office Bills', 'GST Bills');
  assert.equal(
    buildFolderEntries(prefs).find((f) => f.id === 'Office Bills')?.label,
    'GST Bills'
  );

  prefs = deleteFolderFromPrefs(prefs, 'Office Bills');
  assert.equal(
    buildFolderEntries(prefs).some((f) => f.id === 'Office Bills'),
    false
  );
});

test('countDocsInFolder matches document category and folder path', () => {
  const docs = [
    { category: 'Receipts', folder: 'Documents/Receipts' },
    { category: 'Scans', folder: 'Documents/Tax Invoices' },
  ] as ScanDocument[];
  assert.equal(countDocsInFolder(docs, 'Receipts'), 1);
  assert.equal(countDocsInFolder(docs, 'Tax Invoices'), 1);
  assert.equal(countDocsInFolder(docs, 'ID_Cards'), 0);
});
