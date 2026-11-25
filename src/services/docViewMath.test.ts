import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCompactDocTimestamp,
  formatPageBadgeNumber,
  getCategoryChipLabel,
  mapDocumentFilterToStudioPreset,
  removePageFromList,
  rotateCounterClockwise,
  toggleIndexSelection,
} from './docViewMath';
import { STUDIO_FILTER_PRESETS } from './paperCropMath';

test('formatPageBadgeNumber zero-pads page indices', () => {
  assert.equal(formatPageBadgeNumber(0), '01');
  assert.equal(formatPageBadgeNumber(8), '09');
  assert.equal(formatPageBadgeNumber(11), '12');
});

test('formatCompactDocTimestamp formats MM/DD/YY HH:mm cleanly', () => {
  const sample = new Date(2026, 10, 25, 9, 50, 0).toISOString();
  assert.equal(formatCompactDocTimestamp(sample), '11/25/26 09:50');
  assert.equal(formatCompactDocTimestamp('invalid-date'), '');
});

test('getCategoryChipLabel maps document categories to concise labels', () => {
  assert.equal(getCategoryChipLabel('ID_Cards'), 'ID Card');
  assert.equal(getCategoryChipLabel('Mobile_Transfers'), 'PC Sync');
  assert.equal(getCategoryChipLabel('Receipts'), 'Receipts');
});

test('rotateCounterClockwise steps 0 -> 270 -> 180 -> 90 -> 0', () => {
  assert.equal(rotateCounterClockwise(0), 270);
  assert.equal(rotateCounterClockwise(270), 180);
  assert.equal(rotateCounterClockwise(180), 90);
  assert.equal(rotateCounterClockwise(90), 0);
});

test('removePageFromList prevents removing the final page and adjusts index', () => {
  const single = removePageFromList(['p1'], 0);
  assert.deepEqual(single.nextPages, ['p1']);
  assert.equal(single.nextIndex, 0);

  const multi = removePageFromList(['p1', 'p2', 'p3'], 2);
  assert.deepEqual(multi.nextPages, ['p1', 'p2']);
  assert.equal(multi.nextIndex, 1);
});

test('toggleIndexSelection sorts and toggles indices deterministically', () => {
  assert.deepEqual(toggleIndexSelection([2, 0], 1), [0, 1, 2]);
  assert.deepEqual(toggleIndexSelection([0, 1, 2], 1), [0, 2]);
});

test('STUDIO_FILTER_PRESETS matches dark studio filter strip order and badges', () => {
  assert.deepEqual(
    STUDIO_FILTER_PRESETS.map((p) => p.label),
    ['No shadow', 'Original', 'Lighten', 'Magic Color', 'Grayscale', 'B&W']
  );
  assert.equal(STUDIO_FILTER_PRESETS[0].badge, 'Beta');
  assert.equal(mapDocumentFilterToStudioPreset('color'), 'magic-color');
  assert.equal(mapDocumentFilterToStudioPreset('bw'), 'bw');
});
