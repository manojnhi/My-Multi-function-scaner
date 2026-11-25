import type { CornerPoint, DocumentFilterMode } from '../types';
import {
  defaultPaperCorners,
  detectCornersFromRgbaBuffer,
  OKEN_SCENE_PRESETS,
  STUDIO_FILTER_PRESETS,
  type OkenScenePresetId,
  type StudioFilterPresetId,
} from './paperCropMath';

export interface ImageAdjustmentParams {
  filterMode: DocumentFilterMode;
  brightness: number; // -100 .. 100
  contrast: number; // -100 .. 100
  saturation: number; // -100 .. 100
  sharpness: number; // 0 .. 100
  denoise: boolean;
  shadowRemoval: number; // 0 .. 100
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  quality: number; // 0.4 .. 1.0
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  maxWidth?: number;
  cleanStrength?: number; // 0 .. 100 (Document / Page clean tool)
  skinSmooth?: number; // 0 .. 100 (Image Beauty tool)
  warmth?: number; // -50 .. 50
  glow?: number; // 0 .. 100
  vignette?: number; // 0 .. 100
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustmentParams = {
  filterMode: 'color',
  brightness: 4,
  contrast: 12,
  saturation: 0,
  sharpness: 25,
  denoise: false,
  shadowRemoval: 35,
  rotation: 0,
  flipH: false,
  flipV: false,
  quality: 0.88,
  format: 'image/jpeg',
  cleanStrength: 0,
  skinSmooth: 0,
  warmth: 0,
  glow: 0,
  vignette: 0,
};

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Fast real-time paper-edge detector operating directly on a small analysis canvas.
 */
export function detectLiveFrameCorners(canvas: HTMLCanvasElement): {
  corners: CornerPoint[];
  detected: boolean;
  confidence: number;
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  const w = canvas.width;
  const h = canvas.height;
  if (w < 16 || h < 16) return { corners: defaultPaperCorners(), detected: false, confidence: 0 };
  const { data } = ctx.getImageData(0, 0, w, h);
  return detectCornersFromRgbaBuffer(data, w, h);
}

/**
 * Automatic document edge & corner estimator using RGBA connected-component + convex hull + 4-line TLS fit.
 * Returns normalized 0..1 corner coordinates [topLeft, topRight, bottomRight, bottomLeft].
 */
export async function detectDocumentCorners(src: string): Promise<CornerPoint[]> {
  try {
    const img = await loadImageElement(src);
    const w = 220;
    const h = Math.max(100, Math.round((img.height / img.width) * w));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return defaultPaperCorners();
    ctx.drawImage(img, 0, 0, w, h);
    return detectLiveFrameCorners(canvas).corners;
  } catch {
    return defaultPaperCorners();
  }
}

export function defaultCorners(): CornerPoint[] {
  return defaultPaperCorners();
}

/**
 * Solves 3x3 homography mapping destination (0..outW, 0..outH) -> source pixel coordinates
 * using Gaussian elimination, then performs bilinear perspective warp.
 */
function solveHomography(
  srcPts: Array<{ x: number; y: number }>,
  dstPts: Array<{ x: number; y: number }>
): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x;
    const sy = srcPts[i].y;
    const dx = dstPts[i].x;
    const dy = dstPts[i].y;
    A.push([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy]);
    b.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy]);
    b.push(sy);
  }

  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];

    const pivot = A[col][col] || 1e-8;
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let k = col; k < n; k++) {
        A[row][k] -= factor * A[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  const h = new Array<number>(9).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let k = i + 1; k < n; k++) sum -= A[i][k] * h[k];
    h[i] = sum / (A[i][i] || 1e-8);
  }
  return h;
}

export async function warpPerspective(
  src: string,
  corners: CornerPoint[],
  targetMaxDim = 1400
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImageElement(src);
  const srcCanvas = document.createElement('canvas');
  const scale = Math.min(1, targetMaxDim / Math.max(img.width, img.height));
  const sw = Math.round(img.width * scale);
  const sh = Math.round(img.height * scale);
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const sCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) throw new Error('Canvas context unavailable');
  sCtx.drawImage(img, 0, 0, sw, sh);
  const srcImgData = sCtx.getImageData(0, 0, sw, sh);
  const sData = srcImgData.data;

  const px = corners.map((c) => ({ x: c.x * sw, y: c.y * sh }));
  const topW = Math.hypot(px[1].x - px[0].x, px[1].y - px[0].y);
  const botW = Math.hypot(px[2].x - px[3].x, px[2].y - px[3].y);
  const leftH = Math.hypot(px[3].x - px[0].x, px[3].y - px[0].y);
  const rightH = Math.hypot(px[2].x - px[1].x, px[2].y - px[1].y);

  const outW = Math.max(120, Math.round(Math.max(topW, botW)));
  const outH = Math.max(120, Math.round(Math.max(leftH, rightH)));

  const dstPts = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const H = solveHomography(px, dstPts);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const oCtx = outCanvas.getContext('2d');
  if (!oCtx) throw new Error('Output canvas context unavailable');
  const outImgData = oCtx.createImageData(outW, outH);
  const oData = outImgData.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;

      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const oIdx = (y * outW + x) * 4;

      if (ix >= 0 && ix < sw - 1 && iy >= 0 && iy < sh - 1) {
        const fx = sx - ix;
        const fy = sy - iy;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const i00 = (iy * sw + ix) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;

        oData[oIdx] = sData[i00] * w00 + sData[i10] * w10 + sData[i01] * w01 + sData[i11] * w11;
        oData[oIdx + 1] =
          sData[i00 + 1] * w00 + sData[i10 + 1] * w10 + sData[i01 + 1] * w01 + sData[i11 + 1] * w11;
        oData[oIdx + 2] =
          sData[i00 + 2] * w00 + sData[i10 + 2] * w10 + sData[i01 + 2] * w01 + sData[i11 + 2] * w11;
        oData[oIdx + 3] = 255;
      } else {
        oData[oIdx] = 255;
        oData[oIdx + 1] = 255;
        oData[oIdx + 2] = 255;
        oData[oIdx + 3] = 255;
      }
    }
  }

  oCtx.putImageData(outImgData, 0, 0);
  return {
    dataUrl: outCanvas.toDataURL('image/jpeg', 0.92),
    width: outW,
    height: outH,
  };
}

export async function processImage(
  src: string,
  params: ImageAdjustmentParams
): Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
  const img = await loadImageElement(src);
  const targetMax = params.maxWidth || 1600;
  const scale = Math.min(1, targetMax / Math.max(img.width, img.height));
  const rawW = Math.round(img.width * scale);
  const rawH = Math.round(img.height * scale);

  const rotated90 = params.rotation === 90 || params.rotation === 270;
  const outW = rotated90 ? rawH : rawW;
  const outH = rotated90 ? rawW : rawH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((params.rotation * Math.PI) / 180);
  ctx.scale(params.flipH ? -1 : 1, params.flipV ? -1 : 1);
  ctx.drawImage(img, -rawW / 2, -rawH / 2, rawW, rawH);
  ctx.restore();

  const cleanStrength = params.cleanStrength || 0;
  const skinSmooth = params.skinSmooth || 0;
  const warmth = params.warmth || 0;
  const glow = params.glow || 0;
  const vignette = params.vignette || 0;

  if (
    params.filterMode !== 'original' ||
    params.brightness !== 0 ||
    params.contrast !== 0 ||
    params.saturation !== 0 ||
    params.shadowRemoval > 0 ||
    params.sharpness > 0 ||
    params.denoise ||
    cleanStrength > 0 ||
    skinSmooth > 0 ||
    warmth !== 0 ||
    glow > 0 ||
    vignette > 0
  ) {
    const imgData = ctx.getImageData(0, 0, outW, outH);
    const d = imgData.data;

    // 1. Optional 3x3 box denoise pass
    if (params.denoise) {
      const copy = new Uint8ClampedArray(d);
      for (let y = 1; y < outH - 1; y++) {
        for (let x = 1; x < outW - 1; x++) {
          let r = 0,
            g = 0,
            b = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const p = ((y + ky) * outW + (x + kx)) * 4;
              r += copy[p];
              g += copy[p + 1];
              b += copy[p + 2];
            }
          }
          const idx = (y * outW + x) * 4;
          d[idx] = r / 9;
          d[idx + 1] = g / 9;
          d[idx + 2] = b / 9;
        }
      }
    }

    // 2. Document / Page Clean Tool: Adaptive local illumination normalization & stain/dust removal
    if (cleanStrength > 0) {
      const gridW = Math.max(16, Math.min(48, Math.round(outW / 24)));
      const gridH = Math.max(16, Math.min(48, Math.round(outH / 24)));
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = gridW;
      bgCanvas.height = gridH;
      const bgCtx = bgCanvas.getContext('2d');
      let bgField: Uint8ClampedArray | null = null;
      if (bgCtx) {
        bgCtx.filter = 'blur(2px)';
        bgCtx.drawImage(canvas, 0, 0, gridW, gridH);
        // Second pass for smooth illumination envelope
        const envCanvas = document.createElement('canvas');
        envCanvas.width = outW;
        envCanvas.height = outH;
        const envCtx = envCanvas.getContext('2d');
        if (envCtx) {
          envCtx.drawImage(bgCanvas, 0, 0, outW, outH);
          bgField = envCtx.getImageData(0, 0, outW, outH).data;
        }
      }

      const blend = cleanStrength / 100;
      if (bgField) {
        for (let i = 0; i < d.length; i += 4) {
          const bgLum = Math.max(
            75,
            0.299 * bgField[i] + 0.587 * bgField[i + 1] + 0.114 * bgField[i + 2]
          );
          const normR = Math.min(255, (d[i] / bgLum) * 244);
          const normG = Math.min(255, (d[i + 1] / bgLum) * 244);
          const normB = Math.min(255, (d[i + 2] / bgLum) * 244);

          let nr = d[i] * (1 - blend) + normR * blend;
          let ng = d[i + 1] * (1 - blend) + normG * blend;
          let nb = d[i + 2] * (1 - blend) + normB * blend;

          // Whiten light paper speckling & faint bleed-through
          const nLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const whiteCut = 218 - blend * 36;
          if (nLum > whiteCut) {
            const lift = Math.min(1, ((nLum - whiteCut) / (255 - whiteCut)) * (0.45 + 0.55 * blend));
            nr = nr + (255 - nr) * lift;
            ng = ng + (255 - ng) * lift;
            nb = nb + (255 - nb) * lift;
          }
          d[i] = nr;
          d[i + 1] = ng;
          d[i + 2] = nb;
        }
      }
    }

    // 3. Beauty Tool: Edge-preserving skin & surface smoothing
    if (skinSmooth > 0) {
      const copy = new Uint8ClampedArray(d);
      const strength = (skinSmooth / 100) * 0.78;
      const edgeLimit = 38;
      for (let y = 2; y < outH - 2; y++) {
        for (let x = 2; x < outW - 2; x++) {
          const cIdx = (y * outW + x) * 4;
          const cr = copy[cIdx];
          const cg = copy[cIdx + 1];
          const cb = copy[cIdx + 2];
          let sumR = 0,
            sumG = 0,
            sumB = 0,
            wTotal = 0;

          for (let ky = -2; ky <= 2; ky += 2) {
            for (let kx = -2; kx <= 2; kx += 2) {
              const p = ((y + ky) * outW + (x + kx)) * 4;
              const diff =
                Math.abs(copy[p] - cr) + Math.abs(copy[p + 1] - cg) + Math.abs(copy[p + 2] - cb);
              if (diff < edgeLimit * 3) {
                const w = 1 - diff / (edgeLimit * 3);
                sumR += copy[p] * w;
                sumG += copy[p + 1] * w;
                sumB += copy[p + 2] * w;
                wTotal += w;
              }
            }
          }
          if (wTotal > 0) {
            d[cIdx] = cr * (1 - strength) + (sumR / wTotal) * strength;
            d[cIdx + 1] = cg * (1 - strength) + (sumG / wTotal) * strength;
            d[cIdx + 2] = cb * (1 - strength) + (sumB / wTotal) * strength;
          }
        }
      }
    }

    const bOffset = params.brightness * 1.4 + (glow / 100) * 14;
    const cFactor = (259 * (params.contrast + 255)) / (255 * (259 - params.contrast));
    const satFactor = 1 + params.saturation / 100;
    const shadowLift = params.shadowRemoval / 100;
    const glowAmount = glow / 100;
    const vigAmount = vignette / 100;
    const halfW = outW / 2;
    const halfH = outH / 2;
    const maxDistSq = halfW * halfW + halfH * halfH;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = (y * outW + x) * 4;
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];

        // Shadow removal / background cleanup: lift mid-bright paper tones toward clean white
        if (shadowLift > 0) {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 145) {
            const push = ((lum - 145) / 110) * shadowLift * 45;
            r = Math.min(255, r + push);
            g = Math.min(255, g + push);
            b = Math.min(255, b + push);
          }
        }

        // Brightness, Glow & Contrast
        r = cFactor * (r + bOffset - 128) + 128;
        g = cFactor * (g + bOffset - 128) + 128;
        b = cFactor * (b + bOffset - 128) + 128;

        // Warmth / Color Temperature
        if (warmth !== 0) {
          r += warmth * 0.65;
          g += warmth * 0.12;
          b -= warmth * 0.65;
        }

        // Radiant Beauty Glow (soft gamma highlight curve)
        if (glowAmount > 0) {
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const lift = Math.sin(Math.min(1, Math.max(0, lum)) * Math.PI) * glowAmount * 22;
          r += lift;
          g += lift * 0.95;
          b += lift * 0.9;
        }

        if (params.filterMode === 'color') {
          // Document vibrancy & clean white balance boost
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 188) {
            r = r + (255 - r) * 0.35;
            g = g + (255 - g) * 0.35;
            b = b + (255 - b) * 0.35;
          }
        }

        if (params.saturation !== 0 && params.filterMode !== 'grayscale' && params.filterMode !== 'bw') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = gray + (r - gray) * satFactor;
          g = gray + (g - gray) * satFactor;
          b = gray + (b - gray) * satFactor;
        }

        if (params.filterMode === 'grayscale') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = g = b = gray;
        } else if (params.filterMode === 'bw') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const bw = gray > 142 ? 255 : gray < 95 ? 0 : Math.round(((gray - 95) / 47) * 255);
          r = g = b = bw;
        }

        // Studio Portrait Vignette
        if (vigAmount > 0) {
          const dx = x - halfW;
          const dy = y - halfH;
          const distRatio = (dx * dx + dy * dy) / maxDistSq;
          const dark = Math.max(0.45, 1 - distRatio * vigAmount * 0.58);
          r *= dark;
          g *= dark;
          b *= dark;
        }

        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
      }
    }

    // 4. 3x3 Unsharp convolution when sharpness > 0
    if (params.sharpness > 0) {
      const amount = (params.sharpness / 100) * 0.85;
      const copy = new Uint8ClampedArray(d);
      for (let y = 1; y < outH - 1; y++) {
        for (let x = 1; x < outW - 1; x++) {
          const idx = (y * outW + x) * 4;
          const up = idx - outW * 4;
          const dn = idx + outW * 4;
          const lf = idx - 4;
          const rt = idx + 4;
          for (let c = 0; c < 3; c++) {
            const lap = 4 * copy[idx + c] - copy[up + c] - copy[dn + c] - copy[lf + c] - copy[rt + c];
            d[idx + c] = Math.max(0, Math.min(255, copy[idx + c] + lap * amount));
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  const dataUrl = canvas.toDataURL(params.format, params.quality);
  const sizeBytes = Math.round((dataUrl.length * 3) / 4);
  return { dataUrl, width: outW, height: outH, sizeBytes };
}

export async function cleanImageDocument(
  src: string,
  cleanStrength = 80,
  mode: DocumentFilterMode = 'color',
  quality = 0.88
): Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
  return processImage(src, {
    ...DEFAULT_ADJUSTMENTS,
    filterMode: mode,
    cleanStrength,
    shadowRemoval: Math.min(100, cleanStrength),
    denoise: cleanStrength >= 50,
    sharpness: 32,
    brightness: 6,
    contrast: 18,
    quality,
    maxWidth: 1700,
  });
}

/**
 * Real-time Auto Capture frame stability, blur (Laplacian variance), and edge presence analyzer.
 */
export function analyzeFrameStability(
  canvas: HTMLCanvasElement,
  prevGray: Float32Array | null,
  sensitivity: number
): {
  motionScore: number;
  sharpnessScore: number;
  edgePresence: number;
  status: 'searching' | 'detected' | 'hold-steady' | 'ready';
  currentGray: Float32Array;
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      motionScore: 100,
      sharpnessScore: 0,
      edgePresence: 0,
      status: 'searching',
      currentGray: new Float32Array(0),
    };
  }
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Motion delta
  let motionSum = 0;
  if (prevGray && prevGray.length === gray.length) {
    for (let i = 0; i < gray.length; i += 2) {
      motionSum += Math.abs(gray[i] - prevGray[i]);
    }
  } else {
    motionSum = gray.length * 10;
  }
  const motionScore = motionSum / (gray.length / 2);

  // Laplacian sharpness & border edge energy
  let lapSum = 0;
  let edgeCount = 0;
  let samples = 0;
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x;
      const lap = Math.abs(4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w]);
      lapSum += lap;
      if (lap > 18) edgeCount++;
      samples++;
    }
  }
  const sharpnessScore = samples > 0 ? lapSum / samples : 0;
  const edgePresence = samples > 0 ? (edgeCount / samples) * 100 : 0;

  const motionThreshold = 14 - sensitivity * 0.9; // Higher sensitivity requires steadier hold or triggers faster
  const sharpThreshold = 4.2;

  let status: 'searching' | 'detected' | 'hold-steady' | 'ready' = 'searching';
  if (edgePresence > 3.5) {
    if (motionScore > motionThreshold) {
      status = 'detected';
    } else if (sharpnessScore < sharpThreshold) {
      status = 'hold-steady';
    } else {
      status = 'ready';
    }
  }

  return {
    motionScore,
    sharpnessScore,
    edgePresence,
    status,
    currentGray: gray,
  };
}

export interface CropRect {
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
}

export type CropShapeMode = 'rect' | 'perspective' | 'circle' | 'rounded';

export function getDataUrlByteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const b64 = dataUrl.slice(commaIdx + 1);
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export async function cropImageAdvanced(
  src: string,
  options: {
    rect: CropRect;
    shape?: 'rect' | 'circle' | 'rounded';
    cornerRadiusPct?: number;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
    quality?: number;
  }
): Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
  const img = await loadImageElement(src);
  const rx = Math.max(0, Math.min(0.99, options.rect.x));
  const ry = Math.max(0, Math.min(0.99, options.rect.y));
  const rw = Math.max(0.01, Math.min(1 - rx, options.rect.width));
  const rh = Math.max(0.01, Math.min(1 - ry, options.rect.height));

  const sx = Math.round(rx * img.width);
  const sy = Math.round(ry * img.height);
  const sw = Math.max(8, Math.round(rw * img.width));
  const sh = Math.max(8, Math.round(rh * img.height));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  const shape = options.shape ?? 'rect';
  const format =
    options.format ?? (shape === 'circle' || shape === 'rounded' ? 'image/png' : 'image/jpeg');
  const quality = options.quality ?? 0.92;

  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
  }

  ctx.save();
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  } else if (shape === 'rounded') {
    const r = Math.min(sw, sh) * ((options.cornerRadiusPct ?? 8) / 100);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(sw - r, 0);
    ctx.quadraticCurveTo(sw, 0, sw, r);
    ctx.lineTo(sw, sh - r);
    ctx.quadraticCurveTo(sw, sh, sw - r, sh);
    ctx.lineTo(r, sh);
    ctx.quadraticCurveTo(0, sh, 0, sh - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.clip();
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();

  const dataUrl = canvas.toDataURL(format, quality);
  return {
    dataUrl,
    width: sw,
    height: sh,
    sizeBytes: getDataUrlByteLength(dataUrl),
  };
}

export async function resizeImageToManualSize(
  src: string,
  options: {
    targetWidthPx?: number;
    targetHeightPx?: number;
    targetBytes?: number;
    format: 'image/jpeg' | 'image/png' | 'image/webp';
    initialQuality?: number;
  }
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  qualityUsed: number;
  achievedTarget: boolean;
}> {
  const img = await loadImageElement(src);
  let curW = Math.max(16, Math.round(options.targetWidthPx || img.width));
  let curH = Math.max(16, Math.round(options.targetHeightPx || img.height));
  const format = options.format;
  const targetBytes = options.targetBytes && options.targetBytes > 0 ? Math.round(options.targetBytes) : 0;

  const renderAt = (w: number, h: number, q: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL(format, q);
    return { dataUrl, sizeBytes: getDataUrlByteLength(dataUrl) };
  };

  if (!targetBytes) {
    const q = options.initialQuality ?? 0.9;
    const encoded = renderAt(curW, curH, q);
    return {
      dataUrl: encoded.dataUrl,
      width: curW,
      height: curH,
      sizeBytes: encoded.sizeBytes,
      qualityUsed: q,
      achievedTarget: true,
    };
  }

  let bestDataUrl = '';
  let bestBytes = Infinity;
  let bestW = curW;
  let bestH = curH;
  let bestQ = options.initialQuality ?? 0.9;

  for (let dimPass = 0; dimPass < 7; dimPass++) {
    const highProbe = renderAt(curW, curH, 0.94);
    if (highProbe.sizeBytes <= targetBytes) {
      return {
        dataUrl: highProbe.dataUrl,
        width: curW,
        height: curH,
        sizeBytes: highProbe.sizeBytes,
        qualityUsed: 0.94,
        achievedTarget: true,
      };
    }

    if (format !== 'image/png') {
      let lo = 0.14;
      let hi = 0.93;
      let passBestUrl = '';
      let passBestBytes = Infinity;
      let passBestQ = lo;

      for (let step = 0; step < 7; step++) {
        const mid = Number(((lo + hi) / 2).toFixed(3));
        const probe = renderAt(curW, curH, mid);
        if (probe.sizeBytes <= targetBytes) {
          passBestUrl = probe.dataUrl;
          passBestBytes = probe.sizeBytes;
          passBestQ = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }

      if (passBestUrl) {
        return {
          dataUrl: passBestUrl,
          width: curW,
          height: curH,
          sizeBytes: passBestBytes,
          qualityUsed: passBestQ,
          achievedTarget: true,
        };
      }
    }

    const lowProbe = renderAt(curW, curH, 0.14);
    if (lowProbe.sizeBytes < bestBytes) {
      bestDataUrl = lowProbe.dataUrl;
      bestBytes = lowProbe.sizeBytes;
      bestW = curW;
      bestH = curH;
      bestQ = 0.14;
    }

    if (lowProbe.sizeBytes <= targetBytes) {
      return {
        dataUrl: lowProbe.dataUrl,
        width: curW,
        height: curH,
        sizeBytes: lowProbe.sizeBytes,
        qualityUsed: 0.14,
        achievedTarget: true,
      };
    }

    if (curW <= 32 || curH <= 32) break;
    const ratio = Math.sqrt(targetBytes / Math.max(1, lowProbe.sizeBytes)) * 0.92;
    const factor = Math.max(0.35, Math.min(0.84, ratio));
    curW = Math.max(32, Math.round(curW * factor));
    curH = Math.max(32, Math.round(curH * factor));
  }

  return {
    dataUrl: bestDataUrl,
    width: bestW,
    height: bestH,
    sizeBytes: bestBytes,
    qualityUsed: bestQ,
    achievedTarget: bestBytes <= targetBytes,
  };
}

/**
 * Applies one of the Oken Multi-Scene presets (Original, Lighten, Auto, HD Clear, B&W, Black).
 */
export async function applyOkenScenePreset(
  src: string,
  presetId: OkenScenePresetId,
  options?: {
    rotation?: 0 | 90 | 180 | 270;
    maxWidth?: number;
    quality?: number;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
  }
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  filterMode: DocumentFilterMode;
}> {
  const preset = OKEN_SCENE_PRESETS.find((p) => p.id === presetId) ?? OKEN_SCENE_PRESETS[2];
  const res = await processImage(src, {
    ...DEFAULT_ADJUSTMENTS,
    filterMode: preset.filterMode,
    brightness: preset.brightness,
    contrast: preset.contrast,
    saturation: preset.saturation,
    sharpness: preset.sharpness,
    shadowRemoval: preset.shadowRemoval,
    cleanStrength: preset.cleanStrength,
    denoise: preset.denoise,
    rotation: options?.rotation ?? 0,
    maxWidth: options?.maxWidth ?? 1600,
    quality: options?.quality ?? 0.9,
    format: options?.format ?? 'image/jpeg',
  });
  return { ...res, filterMode: preset.filterMode };
}

/**
 * Applies one of the 6 Dark Studio Filter presets (No shadow, Original, Lighten, Magic Color, Grayscale, B&W).
 */
export async function applyStudioFilterPreset(
  src: string,
  presetId: StudioFilterPresetId,
  options?: {
    rotation?: 0 | 90 | 180 | 270;
    maxWidth?: number;
    quality?: number;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
  }
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  filterMode: DocumentFilterMode;
}> {
  const preset =
    STUDIO_FILTER_PRESETS.find((p) => p.id === presetId) ?? STUDIO_FILTER_PRESETS[3];
  const res = await processImage(src, {
    ...DEFAULT_ADJUSTMENTS,
    filterMode: preset.filterMode,
    brightness: preset.brightness,
    contrast: preset.contrast,
    saturation: preset.saturation,
    sharpness: preset.sharpness,
    shadowRemoval: preset.shadowRemoval,
    cleanStrength: preset.cleanStrength,
    denoise: preset.denoise,
    rotation: options?.rotation ?? 0,
    maxWidth: options?.maxWidth ?? 1600,
    quality: options?.quality ?? 0.9,
    format: options?.format ?? 'image/jpeg',
  });
  return { ...res, filterMode: preset.filterMode };
}

/**
 * Composes an Oken-style 1:1 A4 preview & export sheet for ID Cards, Driver Licenses, and Passports.
 */
export async function composeIdCardA4Sheet(
  frontSrc: string,
  backSrc: string | null,
  template: 'single' | 'license' | 'passport' = 'license',
  quality = 0.92
): Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
  const a4W = 1240;
  const a4H = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = a4W;
  canvas.height = a4H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, a4W, a4H);

  const imgF = await loadImageElement(frontSrc);

  if (template === 'passport') {
    const targetW = Math.round(a4W * 0.72);
    const targetH = Math.round(targetW * (imgF.height / Math.max(1, imgF.width)));
    const x = Math.round((a4W - targetW) / 2);
    const y = Math.round((a4H - targetH) / 2);
    ctx.drawImage(imgF, x, y, targetW, targetH);
  } else if (template === 'single' || !backSrc) {
    const targetW = Math.round(a4W * 0.66);
    const targetH = Math.round(targetW * 0.63);
    const x = Math.round((a4W - targetW) / 2);
    const y = Math.round(a4H * 0.24);
    ctx.drawImage(imgF, x, y, targetW, targetH);
  } else {
    const imgB = await loadImageElement(backSrc);
    const cardW = Math.round(a4W * 0.64);
    const cardH = Math.round(cardW * 0.63);
    const x = Math.round((a4W - cardW) / 2);
    const topY = Math.round(a4H * 0.17);
    const gap = Math.round(a4H * 0.08);
    ctx.drawImage(imgF, x, topY, cardW, cardH);
    ctx.drawImage(imgB, x, topY + cardH + gap, cardW, cardH);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl,
    width: a4W,
    height: a4H,
    sizeBytes: getDataUrlByteLength(dataUrl),
  };
}

/**
 * Splits a two-page open book capture into Left and Right pages cleanly.
 */
export async function splitBookSpread(
  src: string,
  quality = 0.92
): Promise<{ left: string; right: string }> {
  const img = await loadImageElement(src);
  const halfW = Math.floor(img.width / 2);
  const h = img.height;

  const makeHalf = (sx: number, sw: number) => {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(img, sx, 0, sw, h, 0, 0, sw, h);
    return c.toDataURL('image/jpeg', quality);
  };

  return {
    left: makeHalf(0, halfW),
    right: makeHalf(halfW, img.width - halfW),
  };
}

/**
 * Stitches one or more page images vertically into a single continuous Long Image for sharing.
 */
export async function composeLongImage(
  imageUrls: string[],
  quality = 0.9
): Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
  if (imageUrls.length === 0) {
    throw new Error('No images provided for long image');
  }
  const imgs = await Promise.all(imageUrls.map((u) => loadImageElement(u)));
  const targetW = Math.min(1400, Math.max(...imgs.map((i) => i.width)));
  const gap = 24;
  const scaledHeights = imgs.map((i) => Math.max(100, Math.round((i.height / i.width) * targetW)));
  const totalH = scaledHeights.reduce((a, b) => a + b, 0) + gap * (imgs.length - 1);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, targetW, totalH);

  let y = 0;
  for (let i = 0; i < imgs.length; i++) {
    ctx.drawImage(imgs[i], 0, y, targetW, scaledHeights[i]);
    y += scaledHeights[i] + gap;
  }

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl,
    width: targetW,
    height: totalH,
    sizeBytes: getDataUrlByteLength(dataUrl),
  };
}
