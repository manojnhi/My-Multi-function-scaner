import type { CornerPoint } from '../types';

export type OkenScenePresetId = 'original' | 'lighten' | 'auto' | 'hd-clear' | 'bw' | 'black';

export interface OkenScenePresetMeta {
  id: OkenScenePresetId;
  label: string;
  filterMode: 'original' | 'color' | 'grayscale' | 'bw';
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  shadowRemoval: number;
  cleanStrength: number;
  denoise: boolean;
}

export const OKEN_SCENE_PRESETS: OkenScenePresetMeta[] = [
  {
    id: 'original',
    label: 'Original',
    filterMode: 'original',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    sharpness: 0,
    shadowRemoval: 0,
    cleanStrength: 0,
    denoise: false,
  },
  {
    id: 'lighten',
    label: 'Lighten',
    filterMode: 'color',
    brightness: 18,
    contrast: 10,
    saturation: 4,
    sharpness: 18,
    shadowRemoval: 65,
    cleanStrength: 35,
    denoise: false,
  },
  {
    id: 'auto',
    label: 'Auto',
    filterMode: 'color',
    brightness: 8,
    contrast: 22,
    saturation: 8,
    sharpness: 32,
    shadowRemoval: 55,
    cleanStrength: 68,
    denoise: true,
  },
  {
    id: 'hd-clear',
    label: 'HD Clear',
    filterMode: 'color',
    brightness: 10,
    contrast: 32,
    saturation: 12,
    sharpness: 58,
    shadowRemoval: 75,
    cleanStrength: 85,
    denoise: true,
  },
  {
    id: 'bw',
    label: 'B&W',
    filterMode: 'bw',
    brightness: 12,
    contrast: 36,
    saturation: 0,
    sharpness: 44,
    shadowRemoval: 70,
    cleanStrength: 80,
    denoise: true,
  },
  {
    id: 'black',
    label: 'Black',
    filterMode: 'grayscale',
    brightness: -6,
    contrast: 46,
    saturation: 0,
    sharpness: 48,
    shadowRemoval: 60,
    cleanStrength: 70,
    denoise: true,
  },
];

export type StudioFilterPresetId =
  | 'no-shadow'
  | 'original'
  | 'lighten'
  | 'magic-color'
  | 'grayscale'
  | 'bw';

export interface StudioFilterPresetMeta {
  id: StudioFilterPresetId;
  label: string;
  badge?: string;
  filterMode: 'original' | 'color' | 'grayscale' | 'bw';
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  shadowRemoval: number;
  cleanStrength: number;
  denoise: boolean;
}

export const STUDIO_FILTER_PRESETS: StudioFilterPresetMeta[] = [
  {
    id: 'no-shadow',
    label: 'No shadow',
    badge: 'Beta',
    filterMode: 'color',
    brightness: 6,
    contrast: 12,
    saturation: 4,
    sharpness: 22,
    shadowRemoval: 52,
    cleanStrength: 55,
    denoise: false,
  },
  {
    id: 'original',
    label: 'Original',
    filterMode: 'original',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    sharpness: 0,
    shadowRemoval: 0,
    cleanStrength: 0,
    denoise: false,
  },
  {
    id: 'lighten',
    label: 'Lighten',
    filterMode: 'color',
    brightness: 16,
    contrast: 6,
    saturation: 4,
    sharpness: 14,
    shadowRemoval: 36,
    cleanStrength: 18,
    denoise: false,
  },
  {
    id: 'magic-color',
    label: 'Magic Color',
    filterMode: 'color',
    brightness: 6,
    contrast: 20,
    saturation: 18,
    sharpness: 32,
    shadowRemoval: 42,
    cleanStrength: 36,
    denoise: false,
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    filterMode: 'grayscale',
    brightness: 4,
    contrast: 18,
    saturation: 0,
    sharpness: 22,
    shadowRemoval: 28,
    cleanStrength: 14,
    denoise: false,
  },
  {
    id: 'bw',
    label: 'B&W',
    filterMode: 'bw',
    brightness: 8,
    contrast: 30,
    saturation: 0,
    sharpness: 34,
    shadowRemoval: 45,
    cleanStrength: 42,
    denoise: true,
  },
];

export function defaultPaperCorners(): CornerPoint[] {
  return [
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ];
}

export function clampCornerPoint(pt: CornerPoint, min = 0.01, max = 0.99): CornerPoint {
  return {
    x: Math.max(min, Math.min(max, pt.x)),
    y: Math.max(min, Math.min(max, pt.y)),
  };
}

/**
 * Computes normalized polygon area (0..1) using the shoelace formula.
 */
export function computeQuadArea(corners: CornerPoint[]): number {
  if (corners.length !== 4) return 0;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Ensures corners are ordered clockwise starting from Top-Left: [TL, TR, BR, BL].
 */
export function orderQuadCorners(pts: CornerPoint[]): CornerPoint[] {
  if (pts.length !== 4) return defaultPaperCorners();
  const sortedBySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sortedBySum[0];
  const br = sortedBySum[3];
  const remaining = [sortedBySum[1], sortedBySum[2]];
  remaining.sort((a, b) => b.x - b.y - (a.x - a.y));
  return [tl, remaining[0], br, remaining[1]];
}

export function isReasonablePaperQuad(corners: CornerPoint[]): boolean {
  if (corners.length !== 4) return false;
  const area = computeQuadArea(corners);
  if (area < 0.07 || area > 0.97) return false;
  const topW = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const botW = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
  const leftH = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  const rightH = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
  return Math.min(topW, botW, leftH, rightH) >= 0.14;
}

/**
 * Exponential moving average smoothing for live camera paper-edge overlay.
 */
export function smoothCorners(
  prev: CornerPoint[] | null,
  next: CornerPoint[],
  alpha = 0.45
): CornerPoint[] {
  if (!prev || prev.length !== 4 || next.length !== 4) return next;
  return next.map((pt, idx) => ({
    x: prev[idx].x * (1 - alpha) + pt.x * alpha,
    y: prev[idx].y * (1 - alpha) + pt.y * alpha,
  }));
}

/**
 * Andrew's monotone chain 2D convex hull returning vertices in CCW order.
 */
function computeConvexHull(points: CornerPoint[]): CornerPoint[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: CornerPoint, a: CornerPoint, b: CornerPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: CornerPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: CornerPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

interface LineEq {
  nx: number;
  ny: number;
  d: number;
}

function fitLineTotalLeastSquares(pts: CornerPoint[], fallbackA: CornerPoint, fallbackB: CornerPoint): LineEq {
  if (pts.length < 3) {
    const dx = fallbackB.x - fallbackA.x;
    const dy = fallbackB.y - fallbackA.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { nx, ny, d: nx * fallbackA.x + ny * fallbackA.y };
  }

  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  return { nx, ny, d: nx * mx + ny * my };
}

function intersectLines(l1: LineEq, l2: LineEq): CornerPoint | null {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 0.16) return null;
  const x = (l1.d * l2.ny - l2.d * l1.ny) / det;
  const y = (l1.nx * l2.d - l2.nx * l1.d) / det;
  if (x < -0.04 || x > 1.04 || y < -0.04 || y > 1.04) return null;
  return clampCornerPoint({ x, y }, 0.01, 0.99);
}

function pointToSegDist(p: CornerPoint, a: CornerPoint, b: CornerPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Extracts exact 4 quadrilateral corners from a binary foreground mask (1 = paper, 0 = background)
 * by selecting the largest center-overlapping connected component, computing its convex hull,
 * locating its 4 extreme corners, and refining each corner via total-least-squares edge line intersection.
 */
function extractPaperQuadFromMask(
  mask: Uint8Array,
  w: number,
  h: number
): { corners: CornerPoint[]; detected: boolean; confidence: number } {
  // 1-step morphological hole-fill so dark printed headers never split the paper interior
  const closed = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) {
        const neighbors =
          mask[idx - 1] +
          mask[idx + 1] +
          mask[idx - w] +
          mask[idx + w] +
          mask[idx - w - 1] +
          mask[idx - w + 1] +
          mask[idx + w - 1] +
          mask[idx + w + 1];
        if (neighbors >= 5) closed[idx] = 1;
      }
    }
  }

  // 4-connected BFS to isolate connected foreground regions
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let labelId = 0;

  let bestLabel = 0;
  let bestScore = -1;
  let bestCount = 0;

  const cx0 = Math.floor(w * 0.25);
  const cx1 = Math.ceil(w * 0.75);
  const cy0 = Math.floor(h * 0.25);
  const cy1 = Math.ceil(h * 0.75);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const startIdx = y * w + x;
      if (closed[startIdx] !== 1 || labels[startIdx] !== 0) continue;

      labelId++;
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      labels[startIdx] = labelId;

      let count = 0;
      let centerHits = 0;

      while (head < tail) {
        const cur = queue[head++];
        count++;
        const px = cur % w;
        const py = (cur - px) / w;
        if (px >= cx0 && px < cx1 && py >= cy0 && py < cy1) {
          centerHits++;
        }

        const nbs = [cur - 1, cur + 1, cur - w, cur + w];
        for (let k = 0; k < 4; k++) {
          const nb = nbs[k];
          if (nb >= 0 && nb < w * h && closed[nb] === 1 && labels[nb] === 0) {
            labels[nb] = labelId;
            queue[tail++] = nb;
          }
        }
      }

      const areaRatio = count / (w * h);
      if (areaRatio < 0.06 || areaRatio > 0.96 || centerHits < 12) continue;

      const score = centerHits * 3.0 + count * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestLabel = labelId;
        bestCount = count;
      }
    }
  }

  if (bestLabel === 0) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  // Collect boundary pixels of the winning document component
  const boundary: CornerPoint[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (labels[idx] !== bestLabel) continue;
      if (
        labels[idx - 1] !== bestLabel ||
        labels[idx + 1] !== bestLabel ||
        labels[idx - w] !== bestLabel ||
        labels[idx + w] !== bestLabel
      ) {
        boundary.push({ x: x / w, y: y / h });
      }
    }
  }

  if (boundary.length < 16) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  const hull = computeConvexHull(boundary);
  const m = hull.length;
  if (m < 4) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  // Find initial 4 corners on convex hull (diagonal i0 <-> i2 + max perpendicular extremes i1, i3)
  let hcx = 0;
  let hcy = 0;
  for (const p of hull) {
    hcx += p.x;
    hcy += p.y;
  }
  hcx /= m;
  hcy /= m;

  let i0 = 0;
  let maxCentroidDist = -1;
  for (let i = 0; i < m; i++) {
    const d = (hull[i].x - hcx) ** 2 + (hull[i].y - hcy) ** 2;
    if (d > maxCentroidDist) {
      maxCentroidDist = d;
      i0 = i;
    }
  }

  let i2 = (i0 + Math.floor(m / 2)) % m;
  let maxDiagDist = -1;
  for (let i = 0; i < m; i++) {
    const d = (hull[i].x - hull[i0].x) ** 2 + (hull[i].y - hull[i0].y) ** 2;
    if (d > maxDiagDist) {
      maxDiagDist = d;
      i2 = i;
    }
  }

  let i1 = -1;
  let maxD1 = -1;
  for (let step = 1; ; step++) {
    const idx = (i0 + step) % m;
    if (idx === i2) break;
    const d = pointToSegDist(hull[idx], hull[i0], hull[i2]);
    if (d > maxD1) {
      maxD1 = d;
      i1 = idx;
    }
  }

  let i3 = -1;
  let maxD3 = -1;
  for (let step = 1; ; step++) {
    const idx = (i2 + step) % m;
    if (idx === i0) break;
    const d = pointToSegDist(hull[idx], hull[i0], hull[i2]);
    if (d > maxD3) {
      maxD3 = d;
      i3 = idx;
    }
  }

  if (i1 === -1 || i3 === -1) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  const rawQuad = [hull[i0], hull[i1], hull[i2], hull[i3]];

  // Fit 4 edge lines using boundary pixels aligned with each side (skipping 9% rounded corner tips)
  const edgeLines: LineEq[] = [];
  for (let side = 0; side < 4; side++) {
    const a = rawQuad[side];
    const b = rawQuad[(side + 1) % 4];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / segLen;
    const uy = (b.y - a.y) / segLen;
    const sidePts: CornerPoint[] = [];

    for (const p of boundary) {
      const proj = ((p.x - a.x) * ux + (p.y - a.y) * uy) / segLen;
      if (proj < 0.09 || proj > 0.91) continue;
      if (pointToSegDist(p, a, b) < 0.022) {
        sidePts.push(p);
      }
    }
    edgeLines.push(fitLineTotalLeastSquares(sidePts, a, b));
  }

  const intersected: CornerPoint[] = [];
  for (let k = 0; k < 4; k++) {
    const pt = intersectLines(edgeLines[(k + 3) % 4], edgeLines[k]);
    intersected.push(pt || clampCornerPoint(rawQuad[k], 0.01, 0.99));
  }

  const candidate = orderQuadCorners(intersected);
  if (!isReasonablePaperQuad(candidate)) {
    const fallbackOrdered = orderQuadCorners(rawQuad.map((p) => clampCornerPoint(p, 0.01, 0.99)));
    if (!isReasonablePaperQuad(fallbackOrdered)) {
      return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
    }
    return { corners: fallbackOrdered, detected: true, confidence: 0.72 };
  }

  const area = computeQuadArea(candidate);
  const fillRatio = Math.min(1, bestCount / Math.max(1, area * w * h));
  const confidence = Math.min(1, Math.max(0.4, 0.55 * fillRatio + 0.45 * Math.min(1, area / 0.55)));
  return { corners: candidate, detected: true, confidence };
}

function boxBlurChannel(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= h) continue;
        for (let kx = -1; kx <= 1; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          cnt++;
        }
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

/**
 * Standard 256-bin Otsu optimal bimodal threshold separating desk background from foreground paper.
 */
function computeOtsuThreshold(lum: Float32Array): {
  threshold: number;
  meanBg: number;
  meanFg: number;
} {
  const hist = new Int32Array(256);
  const total = lum.length;
  let totalSum = 0;
  for (let i = 0; i < total; i++) {
    const b = Math.max(0, Math.min(255, Math.round(lum[i])));
    hist[b]++;
    totalSum += b;
  }

  let wBg = 0;
  let sumBg = 0;
  let maxVar = -1;
  let bestT = 128;
  let bestMeanBg = 0;
  let bestMeanFg = 255;

  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;
    const wFg = total - wBg;
    if (wFg === 0) break;

    sumBg += t * hist[t];
    const mBg = sumBg / wBg;
    const mFg = (totalSum - sumBg) / wFg;
    const between = wBg * wFg * (mBg - mFg) * (mBg - mFg);
    if (between > maxVar) {
      maxVar = between;
      bestT = t;
      bestMeanBg = mBg;
      bestMeanFg = mFg;
    }
  }

  return { threshold: bestT, meanBg: bestMeanBg, meanFg: bestMeanFg };
}

/**
 * Pure grayscale paper boundary detector.
 * Uses 3x3 smoothing + Otsu bimodal valley thresholding + connected component isolation
 * + convex hull + 4-edge TLS intersection.
 */
export function detectCornersFromLumaBuffer(
  lum: Float32Array,
  w: number,
  h: number
): { corners: CornerPoint[]; detected: boolean; confidence: number } {
  if (w < 16 || h < 16 || lum.length < w * h) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  const smooth = boxBlurChannel(lum, w, h);
  const { threshold, meanBg, meanFg } = computeOtsuThreshold(smooth);
  if (meanFg - meanBg < 26) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (smooth[i] > threshold) mask[i] = 1;
  }

  return extractPaperQuadFromMask(mask, w, h);
}

/**
 * Color-aware RGBA paper & ID-card detector.
 * Combines Otsu luminance separation with neutral-desk chroma detection (capturing colored
 * ID card banners cleanly while rejecting sunlit brown wood/desk reflections and corner glare).
 */
export function detectCornersFromRgbaBuffer(
  rgba: Uint8ClampedArray,
  w: number,
  h: number
): { corners: CornerPoint[]; detected: boolean; confidence: number } {
  if (w < 16 || h < 16 || rgba.length < w * h * 4) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  const n = w * h;
  const rRaw = new Float32Array(n);
  const gRaw = new Float32Array(n);
  const bRaw = new Float32Array(n);
  const lumRaw = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    rRaw[i] = rgba[p];
    gRaw[i] = rgba[p + 1];
    bRaw[i] = rgba[p + 2];
    lumRaw[i] = 0.299 * rRaw[i] + 0.587 * gRaw[i] + 0.114 * bRaw[i];
  }

  const rSmooth = boxBlurChannel(rRaw, w, h);
  const gSmooth = boxBlurChannel(gRaw, w, h);
  const bSmooth = boxBlurChannel(bRaw, w, h);
  const lumSmooth = boxBlurChannel(lumRaw, w, h);

  const { threshold: otsuT, meanBg, meanFg } = computeOtsuThreshold(lumSmooth);
  if (meanFg - meanBg < 24) {
    return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  }

  // Compute median RGB & saturation of background pixels below Otsu threshold
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgChromaSum = 0;
  let bgCount = 0;
  for (let i = 0; i < n; i++) {
    if (lumSmooth[i] <= otsuT) {
      bgR += rSmooth[i];
      bgG += gSmooth[i];
      bgB += bSmooth[i];
      bgChromaSum +=
        Math.max(rSmooth[i], gSmooth[i], bSmooth[i]) -
        Math.min(rSmooth[i], gSmooth[i], bSmooth[i]);
      bgCount++;
    }
  }
  if (bgCount > 0) {
    bgR /= bgCount;
    bgG /= bgCount;
    bgB /= bgCount;
  }
  const avgBgChroma = bgCount > 0 ? bgChromaSum / bgCount : 30;
  const isNeutralDesk = avgBgChroma < 18;

  // Slightly favor neutral bright paper when desk itself is warm/bright wood
  const lumThreshold = isNeutralDesk ? otsuT : Math.max(otsuT, meanBg + (meanFg - meanBg) * 0.54);
  const mask = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const lum = lumSmooth[i];
    if (lum > lumThreshold) {
      mask[i] = 1;
      continue;
    }
    if (isNeutralDesk) {
      const colorDiff =
        Math.abs(rSmooth[i] - bgR) + Math.abs(gSmooth[i] - bgG) + Math.abs(bSmooth[i] - bgB);
      const chroma =
        Math.max(rSmooth[i], gSmooth[i], bSmooth[i]) -
        Math.min(rSmooth[i], gSmooth[i], bSmooth[i]);
      if (colorDiff > 44 && chroma > 20 && lum > meanBg * 0.45) {
        mask[i] = 1;
      }
    }
  }

  return extractPaperQuadFromMask(mask, w, h);
}

export function getCropPreviewMetrics(
  corners: CornerPoint[],
  imgW: number,
  imgH: number
): { widthPx: number; heightPx: number; aspectLabel: string } {
  const ordered = orderQuadCorners(corners);
  const topW = Math.hypot((ordered[1].x - ordered[0].x) * imgW, (ordered[1].y - ordered[0].y) * imgH);
  const botW = Math.hypot((ordered[2].x - ordered[3].x) * imgW, (ordered[2].y - ordered[3].y) * imgH);
  const leftH = Math.hypot((ordered[3].x - ordered[0].x) * imgW, (ordered[3].y - ordered[0].y) * imgH);
  const rightH = Math.hypot((ordered[2].x - ordered[1].x) * imgW, (ordered[2].y - ordered[1].y) * imgH);

  const widthPx = Math.max(120, Math.round(Math.max(topW, botW)));
  const heightPx = Math.max(120, Math.round(Math.max(leftH, rightH)));
  const ratio = widthPx / Math.max(1, heightPx);

  let aspectLabel = 'Custom';
  if (Math.abs(ratio - 210 / 297) < 0.08) aspectLabel = 'A4 Portrait';
  else if (Math.abs(ratio - 297 / 210) < 0.08) aspectLabel = 'A4 Landscape';
  else if (Math.abs(ratio - 85.6 / 53.98) < 0.14) aspectLabel = 'ID Card (1:1)';
  else if (Math.abs(ratio - 1) < 0.08) aspectLabel = '1:1 Square';

  return { widthPx, heightPx, aspectLabel };
}

export type AutoScanPhase = 'searching' | 'selected' | 'capturing';

export interface AutoScanStepInput {
  paperDetected: boolean;
  motionScore: number;
  sensitivity: number;
  steadyStreak: number;
  autoCaptureEnabled: boolean;
  nowMs: number;
  lastCaptureAtMs: number;
  cooldownMs?: number;
  requiredSteadyTicks?: number;
}

export interface AutoScanStepResult {
  phase: AutoScanPhase;
  nextStreak: number;
  shouldCapture: boolean;
  progressPct: number;
}

/**
 * Pure state machine for Search -> Auto Document Selection -> Quick Capture flow.
 */
export function evaluateAutoScanStep(input: AutoScanStepInput): AutoScanStepResult {
  if (!input.paperDetected) {
    return { phase: 'searching', nextStreak: 0, shouldCapture: false, progressPct: 0 };
  }

  const requiredTicks = input.requiredSteadyTicks ?? 3;
  const cooldown = input.cooldownMs ?? 3600;
  const motionThreshold = Math.max(4, 15 - input.sensitivity * 0.9);

  if (!input.autoCaptureEnabled || input.nowMs - input.lastCaptureAtMs < cooldown) {
    return { phase: 'selected', nextStreak: 0, shouldCapture: false, progressPct: 0 };
  }

  if (input.motionScore <= motionThreshold) {
    const nextStreak = input.steadyStreak + 1;
    const progressPct = Math.min(100, Math.round((nextStreak / requiredTicks) * 100));
    if (nextStreak >= requiredTicks) {
      return { phase: 'capturing', nextStreak: 0, shouldCapture: true, progressPct: 100 };
    }
    return { phase: 'selected', nextStreak, shouldCapture: false, progressPct };
  }

  const decayed = Math.max(0, input.steadyStreak - 1);
  return {
    phase: 'selected',
    nextStreak: decayed,
    shouldCapture: false,
    progressPct: Math.round((decayed / requiredTicks) * 100),
  };
}

