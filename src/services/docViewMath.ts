import type { DocumentCategory, DocumentFilterMode } from '../types';
import type { StudioFilterPresetId } from './paperCropMath';

export function formatPageBadgeNumber(indexZeroBased: number): string {
  const num = Math.max(1, Math.floor(indexZeroBased) + 1);
  return String(num).padStart(2, '0');
}

export function formatCompactDocTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${min}`;
}

export function getCategoryChipLabel(category: DocumentCategory | string): string {
  switch (category) {
    case 'ID_Cards':
      return 'ID Card';
    case 'PDFs':
      return 'PDF';
    case 'Mobile_Transfers':
      return 'PC Sync';
    case 'Scans':
      return 'Doc';
    default:
      return String(category).replace(/_/g, ' ');
  }
}

export function rotateCounterClockwise(deg: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  return ((deg + 270) % 360) as 0 | 90 | 180 | 270;
}

export function mapDocumentFilterToStudioPreset(filterMode?: DocumentFilterMode): StudioFilterPresetId {
  switch (filterMode) {
    case 'original':
      return 'original';
    case 'grayscale':
      return 'grayscale';
    case 'bw':
      return 'bw';
    case 'color':
    default:
      return 'magic-color';
  }
}

export function removePageFromList<T>(pages: T[], index: number): { nextPages: T[]; nextIndex: number } {
  if (pages.length <= 1 || index < 0 || index >= pages.length) {
    return { nextPages: pages, nextIndex: Math.max(0, Math.min(pages.length - 1, index)) };
  }
  const nextPages = pages.filter((_, idx) => idx !== index);
  const nextIndex = Math.max(0, Math.min(nextPages.length - 1, index));
  return { nextPages, nextIndex };
}

export function toggleIndexSelection(selected: number[], index: number): number[] {
  return selected.includes(index)
    ? selected.filter((i) => i !== index)
    : [...selected, index].sort((a, b) => a - b);
}
