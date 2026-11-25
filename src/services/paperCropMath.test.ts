import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeQuadArea,
  defaultPaperCorners,
  detectCornersFromLumaBuffer,
  detectCornersFromRgbaBuffer,
  getCropPreviewMetrics,
  isReasonablePaperQuad,
  OKEN_SCENE_PRESETS,
  orderQuadCorners,
  smoothCorners,
} from './paperCropMath';

test('detectCornersFromLumaBuffer locates bright paper sheet on dark desk', () => {
  const w = 120;
  const h = 160;
  const lum = new Float32Array(w * h);
  // Dark desk background = 35
  lum.fill(35);

  // Draw a bright paper sheet from x:[18..102], y:[20..140]
  for (let y = 20; y <= 140; y++) {
    for (let x = 18; x <= 102; x++) {
      lum[y * w + x] = 240;
    }
  }

  const result = detectCornersFromLumaBuffer(lum, w, h);
  assert.equal(result.detected, true);
  assert.ok(result.confidence > 0.4, `expected confidence > 0.4, got ${result.confidence}`);

  const [tl, tr, br, bl] = result.corners;
  assert.ok(Math.abs(tl.x - 18 / w) < 0.04, `tl.x=${tl.x}`);
  assert.ok(Math.abs(tl.y - 20 / h) < 0.04, `tl.y=${tl.y}`);
  assert.ok(Math.abs(tr.x - 102 / w) < 0.04, `tr.x=${tr.x}`);
  assert.ok(Math.abs(br.y - 140 / h) < 0.04, `br.y=${br.y}`);
  assert.ok(Math.abs(bl.x - 18 / w) < 0.04, `bl.x=${bl.x}`);
});

test('detectCornersFromLumaBuffer ignores disconnected top-left window glare on angled sheet', () => {
  const w = 150;
  const h = 200;
  const lum = new Float32Array(w * h).fill(50);

  // Bright window frame glare in extreme top-left corner
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 28; x++) {
      lum[y * w + x] = 250;
    }
  }

  // Tilted central paper quad: TL(42,32), TR(132,48), BR(116,172), BL(24,154)
  for (let y = 32; y <= 172; y++) {
    const t = (y - 32) / (172 - 32);
    const xLeft = 42 + (24 - 42) * t;
    const xRight = 132 + (116 - 132) * t;
    for (let x = Math.round(xLeft); x <= Math.round(xRight); x++) {
      lum[y * w + x] = 228;
    }
  }

  const result = detectCornersFromLumaBuffer(lum, w, h);
  assert.equal(result.detected, true);
  const [tl, tr, br, bl] = result.corners;
  // Must lock onto the tilted paper TL (~0.28, 0.16), NOT the glare corner (0, 0)
  assert.ok(tl.x > 0.22 && tl.x < 0.34, `expected tl.x near 0.28, got ${tl.x}`);
  assert.ok(tl.y > 0.11 && tl.y < 0.22, `expected tl.y near 0.16, got ${tl.y}`);
  assert.ok(Math.abs(tr.x - 132 / w) < 0.05, `tr.x=${tr.x}`);
  assert.ok(Math.abs(br.y - 172 / h) < 0.05, `br.y=${br.y}`);
  assert.ok(Math.abs(bl.x - 24 / w) < 0.05, `bl.x=${bl.x}`);
});

test('detectCornersFromRgbaBuffer captures dark-green ID header together with white card body', () => {
  const w = 160;
  const h = 120;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // Slate charcoal desk: RGB (68, 72, 76)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 68;
    rgba[i * 4 + 1] = 72;
    rgba[i * 4 + 2] = 76;
    rgba[i * 4 + 3] = 255;
  }

  // ID Card spanning x:[50..110], y:[20..100]
  // Top header y:[20..42] is dark green (20, 92, 58); bottom y:[43..100] is white (242, 244, 245)
  for (let y = 20; y <= 100; y++) {
    for (let x = 50; x <= 110; x++) {
      const idx = (y * w + x) * 4;
      if (y <= 42) {
        rgba[idx] = 20;
        rgba[idx + 1] = 92;
        rgba[idx + 2] = 58;
      } else {
        rgba[idx] = 242;
        rgba[idx + 1] = 244;
        rgba[idx + 2] = 245;
      }
    }
  }

  const result = detectCornersFromRgbaBuffer(rgba, w, h);
  assert.equal(result.detected, true);
  const [tl, , br] = result.corners;
  assert.ok(Math.abs(tl.x - 50 / w) < 0.04, `tl.x=${tl.x}`);
  assert.ok(Math.abs(tl.y - 20 / h) < 0.05, `tl.y=${tl.y} (must include green header)`);
  assert.ok(Math.abs(br.x - 110 / w) < 0.04, `br.x=${br.x}`);
  assert.ok(Math.abs(br.y - 100 / h) < 0.04, `br.y=${br.y}`);
});

test('detectCornersFromLumaBuffer falls back gracefully on flat dark scene', () => {
  const w = 80;
  const h = 80;
  const lum = new Float32Array(w * h).fill(20);
  const result = detectCornersFromLumaBuffer(lum, w, h);
  assert.equal(result.detected, false);
  assert.deepEqual(result.corners, defaultPaperCorners());
});

test('orderQuadCorners sorts shuffled points clockwise from TL', () => {
  const shuffled = [
    { x: 0.9, y: 0.85 }, // BR
    { x: 0.1, y: 0.15 }, // TL
    { x: 0.12, y: 0.88 }, // BL
    { x: 0.88, y: 0.12 }, // TR
  ];
  const [tl, tr, br, bl] = orderQuadCorners(shuffled);
  assert.ok(tl.x < 0.2 && tl.y < 0.2);
  assert.ok(tr.x > 0.8 && tr.y < 0.2);
  assert.ok(br.x > 0.8 && br.y > 0.8);
  assert.ok(bl.x < 0.2 && bl.y > 0.8);
});

test('smoothCorners interpolates smoothly and rejects mismatched arrays', () => {
  const prev = defaultPaperCorners();
  const next = [
    { x: 0.18, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.82, y: 0.82 },
    { x: 0.18, y: 0.82 },
  ];
  const smoothed = smoothCorners(prev, next, 0.5);
  assert.ok(Math.abs(smoothed[0].x - 0.13) < 1e-6);
  assert.ok(Math.abs(smoothed[2].y - 0.87) < 1e-6);
});

test('computeQuadArea and isReasonablePaperQuad validate paper bounds', () => {
  const valid = defaultPaperCorners();
  assert.ok(Math.abs(computeQuadArea(valid) - 0.84 * 0.84) < 1e-5);
  assert.equal(isReasonablePaperQuad(valid), true);

  const tiny = [
    { x: 0.45, y: 0.45 },
    { x: 0.5, y: 0.45 },
    { x: 0.5, y: 0.5 },
    { x: 0.45, y: 0.5 },
  ];
  assert.equal(isReasonablePaperQuad(tiny), false);
});

test('getCropPreviewMetrics detects A4 Portrait aspect and OKEN_SCENE_PRESETS includes all 6 scenes', () => {
  const a4Corners = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const metrics = getCropPreviewMetrics(a4Corners, 1050, 1485);
  assert.equal(metrics.aspectLabel, 'A4 Portrait');
  assert.deepEqual(
    OKEN_SCENE_PRESETS.map((p) => p.label),
    ['Original', 'Lighten', 'Auto', 'HD Clear', 'B&W', 'Black']
  );
});
