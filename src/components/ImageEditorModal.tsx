import {
  Check,
  Circle,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  Link2Off,
  Loader2,
  Maximize2,
  PenTool,
  RotateCcw,
  RotateCw,
  ScanLine,
  Sliders,
  Sparkles,
  Square,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../services/db';
import {
  cropImageAdvanced,
  DEFAULT_ADJUSTMENTS,
  detectDocumentCorners,
  getDataUrlByteLength,
  loadImageElement,
  processImage,
  resizeImageToManualSize,
  warpPerspective,
  type CropRect,
  type CropShapeMode,
  type ImageAdjustmentParams,
} from '../services/imageProcessor';
import type { CornerPoint, DocumentFilterMode, ScanDocument } from '../types';

export type EditorStudioTab = 'clean' | 'beauty' | 'crop' | 'resize';

interface ImageEditorModalProps {
  document: ScanDocument;
  initialTab?: EditorStudioTab;
  onClose: () => void;
  onSave: (updatedDataUrl: string, filterMode: DocumentFilterMode, sizeBytes: number) => Promise<void>;
}

type DragAction =
  | { type: 'move'; startX: number; startY: number; orig: CropRect }
  | { type: 'handle'; handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'; startX: number; startY: number; orig: CropRect };

interface AspectPreset {
  id: string;
  label: string;
  ratio: number | null; // width / height, null = Free
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1 Square', ratio: 1 },
  { id: '4:3', label: '4:3 Cam', ratio: 4 / 3 },
  { id: '16:9', label: '16:9 Wide', ratio: 16 / 9 },
  { id: '3:2', label: '3:2 Photo', ratio: 3 / 2 },
  { id: 'a4', label: 'A4 Sheet', ratio: 210 / 297 },
  { id: 'letter', label: 'Letter', ratio: 8.5 / 11 },
  { id: 'idcard', label: 'ID Card', ratio: 85.6 / 53.98 },
  { id: 'passport', label: 'Passport', ratio: 35 / 45 },
];

export function ImageEditorModal({
  document: doc,
  initialTab = 'clean',
  onClose,
  onSave,
}: ImageEditorModalProps) {
  const [workingSrc, setWorkingSrc] = useState(doc.dataUrl);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [previewSrc, setPreviewSrc] = useState(doc.dataUrl);
  const [natDims, setNatDims] = useState<{ w: number; h: number }>({ w: 1200, h: 1600 });
  const [workingBytes, setWorkingBytes] = useState<number>(
    doc.sizeBytes || getDataUrlByteLength(doc.dataUrl)
  );
  const [preserveExactWorkingBytes, setPreserveExactWorkingBytes] = useState(false);

  const [params, setParams] = useState<ImageAdjustmentParams>({
    ...DEFAULT_ADJUSTMENTS,
    filterMode: doc.filterMode || 'color',
    maxWidth: 1600,
    format:
      doc.mimeType === 'image/png'
        ? 'image/png'
        : doc.mimeType === 'image/webp'
        ? 'image/webp'
        : 'image/jpeg',
  });

  // 4-Corner Perspective Crop
  const [corners, setCorners] = useState<CornerPoint[] | null>(null);
  const [activeCornerIdx, setActiveCornerIdx] = useState<number | null>(null);

  // All-Types Visual Cropper State
  const [cropShape, setCropShape] = useState<CropShapeMode>('rect');
  const [aspectId, setAspectId] = useState<string>('free');
  const [aspectLandscape, setAspectLandscape] = useState(false);
  const [cornerRadiusPct, setCornerRadiusPct] = useState(8);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
  const dragActionRef = useRef<DragAction | null>(null);

  // Manual File Size & Dimension Resize Feed State
  const [targetSizeVal, setTargetSizeVal] = useState('100');
  const [targetSizeUnit, setTargetSizeUnit] = useState<'KB' | 'MB'>('KB');
  const [dimUnit, setDimUnit] = useState<'px' | 'mm' | 'cm' | 'in'>('px');
  const [dpi, setDpi] = useState(300);
  const [manualWidthInput, setManualWidthInput] = useState('1200');
  const [manualHeightInput, setManualHeightInput] = useState('1600');
  const [lockAspect, setLockAspect] = useState(true);
  const [resizeFormat, setResizeFormat] = useState<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg');
  const [resizeReport, setResizeReport] = useState('');

  // Signature / Stamp Overlay State
  const [signMode, setSignMode] = useState(false);
  const [inkColor, setInkColor] = useState('#0f172a');
  const [isDrawing, setIsDrawing] = useState(false);
  const signCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [studioTab, setStudioTab] = useState<EditorStudioTab>(initialTab);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const cropOverlayActive = studioTab === 'crop';
  const perspectiveActive = cropOverlayActive && cropShape === 'perspective';
  const boxCropActive = cropOverlayActive && cropShape !== 'perspective';

  const activeTargetRatio = useMemo(() => {
    const preset = ASPECT_PRESETS.find((p) => p.id === aspectId);
    if (!preset || !preset.ratio) return null;
    if (aspectLandscape && preset.ratio < 1) return 1 / preset.ratio;
    if (!aspectLandscape && preset.ratio > 1 && preset.id !== 'idcard') return preset.ratio;
    return aspectLandscape ? Math.max(preset.ratio, 1 / preset.ratio) : preset.ratio;
  }, [aspectId, aspectLandscape]);

  const toPhysicalDisplay = (px: number, unit: 'px' | 'mm' | 'cm' | 'in', currentDpi: number) => {
    if (unit === 'px') return String(Math.round(px));
    const inches = px / Math.max(1, currentDpi);
    if (unit === 'in') return inches.toFixed(2);
    if (unit === 'cm') return (inches * 2.54).toFixed(2);
    return (inches * 25.4).toFixed(1);
  };

  const toPixelValue = (valStr: string, unit: 'px' | 'mm' | 'cm' | 'in', currentDpi: number) => {
    const val = parseFloat(valStr);
    if (Number.isNaN(val) || val <= 0) return 0;
    if (unit === 'px') return Math.round(val);
    if (unit === 'in') return Math.round(val * currentDpi);
    if (unit === 'cm') return Math.round((val / 2.54) * currentDpi);
    return Math.round((val / 25.4) * currentDpi);
  };

  // Measure working image pixel dimensions & bytes whenever workingSrc changes
  useEffect(() => {
    let active = true;
    setWorkingBytes(getDataUrlByteLength(workingSrc));
    loadImageElement(workingSrc)
      .then((img) => {
        if (!active) return;
        setNatDims({ w: img.width, h: img.height });
        setManualWidthInput(toPhysicalDisplay(img.width, dimUnit, dpi));
        setManualHeightInput(toPhysicalDisplay(img.height, dimUnit, dpi));
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingSrc]);

  // Update physical inputs when dimUnit or dpi switches
  useEffect(() => {
    setManualWidthInput(toPhysicalDisplay(natDims.w, dimUnit, dpi));
    setManualHeightInput(toPhysicalDisplay(natDims.h, dimUnit, dpi));
  }, [dimUnit, dpi, natDims.h, natDims.w]);

  // Live preview processing when sliders change
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (preserveExactWorkingBytes) {
          if (!cancelled) setPreviewSrc(workingSrc);
          return;
        }
        const res = await processImage(workingSrc, {
          ...params,
          maxWidth: Math.min(1100, params.maxWidth || 1600),
        });
        if (!cancelled) setPreviewSrc(res.dataUrl);
      } catch {
        // ignore transient preview error
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workingSrc, params, preserveExactWorkingBytes]);

  const pushWorkingSrc = (nextSrc: string, keepExact = false) => {
    setHistoryStack((prev) => [...prev.slice(-8), workingSrc]);
    setWorkingSrc(nextSrc);
    setPreserveExactWorkingBytes(keepExact);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setHistoryStack((s) => s.slice(0, -1));
    setWorkingSrc(prev);
    setPreserveExactWorkingBytes(false);
    setResizeReport('');
  };

  // Auto-fit cropRect when user chooses an aspect preset
  const applyAspectPreset = (presetId: string, landscapeOverride?: boolean) => {
    setAspectId(presetId);
    const preset = ASPECT_PRESETS.find((p) => p.id === presetId);
    if (!preset || !preset.ratio) return;
    const isLand = landscapeOverride ?? aspectLandscape;
    const targetRatio = isLand ? Math.max(preset.ratio, 1 / preset.ratio) : preset.ratio;
    const imgRatio = natDims.w / Math.max(1, natDims.h);

    // Normalized ratio: normW / normH = targetRatio / imgRatio
    const normRatio = targetRatio / imgRatio;
    let w = 0.82;
    let h = w / normRatio;
    if (h > 0.86) {
      h = 0.86;
      w = h * normRatio;
    }
    if (w > 0.9) {
      w = 0.9;
      h = w / normRatio;
    }
    setCropRect({
      x: Math.max(0.02, (1 - w) / 2),
      y: Math.max(0.02, (1 - h) / 2),
      width: Math.min(0.96, w),
      height: Math.min(0.96, h),
    });
  };

  const handleDetectCorners = async () => {
    setBusy(true);
    try {
      const detected = await detectDocumentCorners(workingSrc);
      setCorners(detected);
      setCropShape('perspective');
      setSignMode(false);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyPerspectiveWarp = async () => {
    if (!corners) return;
    setBusy(true);
    try {
      const warped = await warpPerspective(workingSrc, corners, 1800);
      pushWorkingSrc(warped.dataUrl, false);
      setCorners(null);
      setCropShape('rect');
      setResizeReport(`Perspective flattened (${warped.width} × ${warped.height} px)`);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyShapeCrop = async () => {
    setBusy(true);
    try {
      const shapeArg = cropShape === 'perspective' ? 'rect' : cropShape;
      const outFmt =
        shapeArg === 'circle' || shapeArg === 'rounded'
          ? params.format === 'image/jpeg'
            ? 'image/png'
            : params.format
          : params.format;
      const res = await cropImageAdvanced(workingSrc, {
        rect: cropRect,
        shape: shapeArg,
        cornerRadiusPct,
        format: outFmt,
        quality: params.quality,
      });
      pushWorkingSrc(res.dataUrl, false);
      if (outFmt !== params.format) {
        setParams((p) => ({ ...p, format: outFmt }));
      }
      setCropRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
      setResizeReport(
        `Cropped (${shapeArg}) -> ${res.width} × ${res.height} px (${formatBytes(res.sizeBytes)})`
      );
    } finally {
      setBusy(false);
    }
  };

  // Interactive crop box pointer dragging
  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (perspectiveActive && activeCornerIdx !== null && corners && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const nx = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height));
      setCorners((prev) =>
        prev ? prev.map((pt, idx) => (idx === activeCornerIdx ? { x: nx, y: ny } : pt)) : prev
      );
      return;
    }

    if (boxCropActive && dragActionRef.current && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragActionRef.current.startX) / rect.width;
      const dy = (e.clientY - dragActionRef.current.startY) / rect.height;
      const orig = dragActionRef.current.orig;

      if (dragActionRef.current.type === 'move') {
        const nx = Math.max(0, Math.min(1 - orig.width, orig.x + dx));
        const ny = Math.max(0, Math.min(1 - orig.height, orig.y + dy));
        setCropRect({ ...orig, x: nx, y: ny });
        return;
      }

      const h = dragActionRef.current.handle;
      let left = orig.x;
      let top = orig.y;
      let right = orig.x + orig.width;
      let bottom = orig.y + orig.height;
      const minSpan = 0.06;

      if (h.includes('w')) left = Math.max(0, Math.min(right - minSpan, orig.x + dx));
      if (h.includes('e')) right = Math.min(1, Math.max(left + minSpan, orig.x + orig.width + dx));
      if (h.includes('n')) top = Math.max(0, Math.min(bottom - minSpan, orig.y + dy));
      if (h.includes('s')) bottom = Math.min(1, Math.max(top + minSpan, orig.y + orig.height + dy));

      let nw = right - left;
      let nh = bottom - top;

      if (activeTargetRatio) {
        const imgRatio = natDims.w / Math.max(1, natDims.h);
        const normRatio = activeTargetRatio / imgRatio;
        if (h === 'n' || h === 's') {
          nw = Math.min(1 - left, nh * normRatio);
          nh = nw / normRatio;
        } else {
          nh = Math.min(1 - top, nw / normRatio);
          nw = nh * normRatio;
        }
        if (h.includes('w')) left = Math.max(0, right - nw);
        if (h.includes('n')) top = Math.max(0, bottom - nh);
      }

      setCropRect({
        x: Math.max(0, left),
        y: Math.max(0, top),
        width: Math.max(minSpan, Math.min(1 - left, nw)),
        height: Math.max(minSpan, Math.min(1 - top, nh)),
      });
      return;
    }

    if (!cropOverlayActive && panning) {
      setPan({
        x: panStartRef.current.originX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.originY + (e.clientY - panStartRef.current.y),
      });
    }
  };

  // Manual Width / Height change handlers with Aspect Lock
  const handleManualWidthChange = (valStr: string) => {
    setManualWidthInput(valStr);
    if (!lockAspect) return;
    const pxW = toPixelValue(valStr, dimUnit, dpi);
    if (pxW > 0) {
      const pxH = Math.round((pxW * natDims.h) / Math.max(1, natDims.w));
      setManualHeightInput(toPhysicalDisplay(pxH, dimUnit, dpi));
    }
  };

  const handleManualHeightChange = (valStr: string) => {
    setManualHeightInput(valStr);
    if (!lockAspect) return;
    const pxH = toPixelValue(valStr, dimUnit, dpi);
    if (pxH > 0) {
      const pxW = Math.round((pxH * natDims.w) / Math.max(1, natDims.h));
      setManualWidthInput(toPhysicalDisplay(pxW, dimUnit, dpi));
    }
  };

  const handleApplyManualTargetSize = async () => {
    const rawNum = parseFloat(targetSizeVal);
    if (Number.isNaN(rawNum) || rawNum <= 0) {
      setResizeReport('Enter a valid positive file size (e.g., 50 KB or 1.5 MB).');
      return;
    }
    const targetBytes =
      targetSizeUnit === 'MB' ? Math.round(rawNum * 1024 * 1024) : Math.round(rawNum * 1024);

    setBusy(true);
    setResizeReport('');
    try {
      const reqW = toPixelValue(manualWidthInput, dimUnit, dpi) || natDims.w;
      const reqH = toPixelValue(manualHeightInput, dimUnit, dpi) || natDims.h;
      const res = await resizeImageToManualSize(workingSrc, {
        targetWidthPx: reqW,
        targetHeightPx: reqH,
        targetBytes,
        format: resizeFormat,
        initialQuality: params.quality,
      });
      pushWorkingSrc(res.dataUrl, true);
      setParams((p) => ({
        ...p,
        format: resizeFormat,
        quality: res.qualityUsed,
        maxWidth: Math.max(res.width, res.height),
      }));
      setResizeReport(
        res.achievedTarget
          ? `Resized to ${formatBytes(res.sizeBytes)} (${res.width} × ${res.height} px · ${Math.round(
              res.qualityUsed * 100
            )}% quality) — under your ${rawNum} ${targetSizeUnit} limit.`
          : `Reached minimum ${formatBytes(res.sizeBytes)} (${res.width} × ${res.height} px). Switch to JPEG/WEBP for even smaller files.`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleApplyManualDimensionsOnly = async () => {
    const reqW = toPixelValue(manualWidthInput, dimUnit, dpi);
    const reqH = toPixelValue(manualHeightInput, dimUnit, dpi);
    if (reqW < 16 || reqH < 16) {
      setResizeReport('Width and height must calculate to at least 16 px.');
      return;
    }
    setBusy(true);
    setResizeReport('');
    try {
      const res = await resizeImageToManualSize(workingSrc, {
        targetWidthPx: reqW,
        targetHeightPx: reqH,
        format: resizeFormat,
        initialQuality: params.quality,
      });
      pushWorkingSrc(res.dataUrl, true);
      setParams((p) => ({
        ...p,
        format: resizeFormat,
        maxWidth: Math.max(res.width, res.height),
      }));
      setResizeReport(`Resized to ${res.width} × ${res.height} px (${formatBytes(res.sizeBytes)}).`);
    } finally {
      setBusy(false);
    }
  };

  // Signature pad drawing handlers
  const getSignCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleSignDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getSignCoords(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const handleSignMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !signCanvasRef.current) return;
    const ctx = signCanvasRef.current.getContext('2d');
    if (!ctx) return;
    const { x, y } = getSignCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleClearSignature = () => {
    const canvas = signCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleApplySignatureToDoc = async () => {
    const signCanvas = signCanvasRef.current;
    if (!signCanvas) return;
    setBusy(true);
    try {
      const baseImg = await loadImageElement(workingSrc);
      const out = document.createElement('canvas');
      out.width = baseImg.width;
      out.height = baseImg.height;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(baseImg, 0, 0);

      const sigW = Math.round(out.width * 0.34);
      const sigH = Math.round((signCanvas.height / signCanvas.width) * sigW);
      ctx.drawImage(
        signCanvas,
        out.width - sigW - out.width * 0.06,
        out.height - sigH - out.height * 0.06,
        sigW,
        sigH
      );
      pushWorkingSrc(out.toDataURL('image/jpeg', 0.94), false);
      setSignMode(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (preserveExactWorkingBytes) {
        await onSave(workingSrc, params.filterMode, getDataUrlByteLength(workingSrc));
        onClose();
        return;
      }
      const finalRes = await processImage(workingSrc, params);
      await onSave(finalRes.dataUrl, params.filterMode, finalRes.sizeBytes);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const filterModes: Array<{ id: DocumentFilterMode; label: string }> = [
    { id: 'color', label: 'Color Doc' },
    { id: 'grayscale', label: 'Grayscale' },
    { id: 'bw', label: 'B&W Crisp' },
    { id: 'original', label: 'Original' },
  ];

  const cropPxPreview = {
    x: Math.round(cropRect.x * natDims.w),
    y: Math.round(cropRect.y * natDims.h),
    w: Math.max(8, Math.round(cropRect.width * natDims.w)),
    h: Math.max(8, Math.round(cropRect.height * natDims.h)),
  };

  const cropHandles: Array<{
    id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
    style: React.CSSProperties;
    cursor: string;
  }> = [
    { id: 'nw', style: { left: '0%', top: '0%' }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: '50%', top: '0%' }, cursor: 'ns-resize' },
    { id: 'ne', style: { left: '100%', top: '0%' }, cursor: 'nesw-resize' },
    { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: '0%', top: '100%' }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: '0%', top: '50%' }, cursor: 'ew-resize' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Image, Cropper, and Manual Size Studio"
    >
      <div className="w-full max-w-6xl h-[92vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Document & Image Crop, Resize & Enhance Studio
            </h2>
            <p className="text-xs text-slate-500 tabular-nums truncate">
              {doc.fileName} · {natDims.w} × {natDims.h} px · {formatBytes(workingBytes)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {historyStack.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                title="Undo last crop or resize"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
            )}
            <div className="hidden sm:flex items-center gap-1 bg-slate-100 rounded-lg px-1.5 py-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className="p-1 text-slate-600 hover:text-slate-900 rounded"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums px-1.5 text-slate-700">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                className="p-1 text-slate-600 hover:text-slate-900 rounded"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1 text-slate-600 hover:text-slate-900 rounded"
                title="Reset Zoom"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Canvas Stage */}
          <div
            onWheel={(e) => {
              if (cropOverlayActive) return;
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) => Math.max(0.5, Math.min(3, Number((z + delta).toFixed(2)))));
            }}
            className={`h-[46vh] min-h-[230px] shrink-0 md:h-auto md:flex-1 md:min-w-0 md:min-h-0 bg-slate-900 flex flex-col items-center justify-center p-3 md:p-4 relative ${
              signMode ? 'overflow-y-auto' : 'overflow-hidden'
            }`}
          >
            <div
              ref={stageRef}
              onPointerDown={(e) => {
                if (cropOverlayActive || zoom <= 1) return;
                setPanning(true);
                panStartRef.current = { x: e.clientX, y: e.clientY, originX: pan.x, originY: pan.y };
              }}
              onPointerMove={handleStagePointerMove}
              onPointerUp={() => {
                setActiveCornerIdx(null);
                dragActionRef.current = null;
                setPanning(false);
              }}
              onPointerLeave={() => {
                setActiveCornerIdx(null);
                dragActionRef.current = null;
                setPanning(false);
              }}
              style={
                !cropOverlayActive
                  ? {
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: 'center center',
                    }
                  : undefined
              }
              className={`relative max-h-full max-w-full select-none touch-none ${
                !cropOverlayActive && zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              <img
                src={cropOverlayActive ? workingSrc : previewSrc}
                alt={doc.title}
                className="max-h-[34vh] sm:max-h-[37vh] md:max-h-[70vh] max-w-full w-auto object-contain rounded shadow-lg block"
                draggable={false}
              />

              {/* All-Types Visual Box / Circle / Rounded Crop Overlay */}
              {boxCropActive && (
                <div className="absolute inset-0 overflow-hidden rounded">
                  {/* Interactive Crop Selection Box with outer backdrop via box-shadow */}
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragActionRef.current = {
                        type: 'move',
                        startX: e.clientX,
                        startY: e.clientY,
                        orig: cropRect,
                      };
                    }}
                    style={{
                      left: `${cropRect.x * 100}%`,
                      top: `${cropRect.y * 100}%`,
                      width: `${cropRect.width * 100}%`,
                      height: `${cropRect.height * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.58)',
                      borderRadius:
                        cropShape === 'circle'
                          ? '9999px'
                          : cropShape === 'rounded'
                          ? `${cornerRadiusPct}%`
                          : '2px',
                    }}
                    className="absolute border-2 border-emerald-400 cursor-move"
                  >
                    {/* Rule-of-thirds grid inside crop area */}
                    <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                      <div className="border-r border-b border-white/25" />
                      <div className="border-r border-b border-white/25" />
                      <div className="border-b border-white/25" />
                      <div className="border-r border-b border-white/25" />
                      <div className="border-r border-b border-white/25" />
                      <div className="border-b border-white/25" />
                      <div className="border-r border-white/25" />
                      <div className="border-r border-white/25" />
                      <div />
                    </div>

                    {/* 8 Drag Handles */}
                    {cropHandles.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        aria-label={`Resize crop ${h.id}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          dragActionRef.current = {
                            type: 'handle',
                            handle: h.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            orig: cropRect,
                          };
                        }}
                        style={{ ...h.style, cursor: h.cursor }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-emerald-600 rounded-sm shadow"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 4-Corner Perspective Polygon Overlay */}
              {perspectiveActive && corners && (
                <>
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polygon
                      points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                      fill="rgba(16, 185, 129, 0.14)"
                      stroke="#10b981"
                      strokeWidth="0.6"
                    />
                  </svg>
                  {corners.map((c, idx) => (
                    <button
                      key={idx}
                      type="button"
                      aria-label={`Drag corner ${idx + 1}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setActiveCornerIdx(idx);
                      }}
                      style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white shadow-md cursor-grab active:cursor-grabbing"
                    />
                  ))}
                </>
              )}
            </div>

            {cropOverlayActive && (
              <div className="mt-3 flex flex-wrap items-center gap-2 bg-slate-800/95 px-3.5 py-2 rounded-xl border border-slate-700 text-xs">
                {perspectiveActive ? (
                  <>
                    <span className="text-slate-200">Drag the 4 green corners to document edges</span>
                    <button
                      type="button"
                      onClick={handleApplyPerspectiveWarp}
                      disabled={busy || !corners}
                      className="px-3 py-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                    >
                      {busy ? 'Flattening...' : 'Apply Perspective Warp'}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-mono tabular-nums text-emerald-300">
                      Selection: {cropPxPreview.w} × {cropPxPreview.h} px
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyShapeCrop}
                      disabled={busy}
                      className="px-3 py-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                    >
                      {busy ? 'Cropping...' : 'Apply Crop'}
                    </button>
                  </>
                )}
              </div>
            )}

            {signMode && (
              <div className="mt-3 bg-white rounded-xl p-3 border border-slate-300 shadow-lg w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">Draw Handwritten Signature</span>
                  <div className="flex items-center gap-1.5">
                    {['#0f172a', '#1d4ed8', '#065f46'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setInkColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-4 h-4 rounded-full border ${
                          inkColor === c ? 'ring-2 ring-offset-1 ring-emerald-600' : ''
                        }`}
                        aria-label={`Ink color ${c}`}
                      />
                    ))}
                  </div>
                </div>
                <canvas
                  ref={signCanvasRef}
                  width={360}
                  height={110}
                  onPointerDown={handleSignDown}
                  onPointerMove={handleSignMove}
                  onPointerUp={() => setIsDrawing(false)}
                  onPointerLeave={() => setIsDrawing(false)}
                  className="w-full h-28 bg-slate-50 border border-dashed border-slate-300 rounded-lg touch-none cursor-crosshair"
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleClearSignature}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    Clear
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSignMode(false)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleApplySignatureToDoc}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-lg hover:bg-emerald-900"
                    >
                      Stamp on Document
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Controls Sidebar */}
          <aside className="flex-1 min-h-0 md:flex-none w-full md:w-[340px] lg:w-96 border-t md:border-t-0 md:border-l border-slate-200 bg-slate-50 p-3.5 md:p-4 overflow-y-auto space-y-4">
            {/* Studio Sub-Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/75 rounded-xl">
              <button
                type="button"
                onClick={() => setStudioTab('crop')}
                className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-colors ${
                  studioTab === 'crop' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                All Crop
              </button>
              <button
                type="button"
                onClick={() => setStudioTab('resize')}
                className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-colors ${
                  studioTab === 'resize' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Resize KB
              </button>
              <button
                type="button"
                onClick={() => setStudioTab('clean')}
                className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-colors ${
                  studioTab === 'clean' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Clean
              </button>
              <button
                type="button"
                onClick={() => setStudioTab('beauty')}
                className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-colors ${
                  studioTab === 'beauty' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Beauty
              </button>
            </div>

            {resizeReport && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 font-medium">
                {resizeReport}
              </div>
            )}

            {/* ALL-TYPES CROPPER TAB */}
            {studioTab === 'crop' && (
              <div className="space-y-4">
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Crop className="w-3.5 h-3.5 text-emerald-700" />
                    Crop Type Mode
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCropShape('rect')}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg border ${
                        cropShape === 'rect'
                          ? 'bg-emerald-800 border-emerald-800 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <Square className="w-3.5 h-3.5" />
                      Rectangle Box
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDetectCorners()}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg border ${
                        cropShape === 'perspective'
                          ? 'bg-emerald-800 border-emerald-800 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                      4-Corner Warp
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCropShape('circle');
                        applyAspectPreset('1:1');
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg border ${
                        cropShape === 'circle'
                          ? 'bg-emerald-800 border-emerald-800 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <Circle className="w-3.5 h-3.5" />
                      Circle / Oval
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropShape('rounded')}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg border ${
                        cropShape === 'rounded'
                          ? 'bg-emerald-800 border-emerald-800 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <Square className="w-3.5 h-3.5 rounded" />
                      Rounded Card
                    </button>
                  </div>

                  {cropShape === 'rounded' && (
                    <label className="block pt-1">
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>Corner Radius</span>
                        <span className="font-mono tabular-nums">{cornerRadiusPct}%</span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={28}
                        value={cornerRadiusPct}
                        onChange={(e) => setCornerRadiusPct(Number(e.target.value))}
                        className="w-full accent-emerald-700"
                      />
                    </label>
                  )}
                </div>

                {cropShape !== 'perspective' && (
                  <>
                    {/* Aspect Ratio Presets */}
                    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900">Aspect Ratio & Doc Presets</span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextLand = !aspectLandscape;
                            setAspectLandscape(nextLand);
                            applyAspectPreset(aspectId, nextLand);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 hover:underline"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {aspectLandscape ? 'Landscape' : 'Portrait'}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {ASPECT_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyAspectPreset(p.id)}
                            className={`py-1.5 px-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                              aspectId === p.id
                                ? 'bg-emerald-800 border-emerald-800 text-white'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-600'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Manual Crop Coordinates Feed (Pixels) */}
                    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">Manual Crop Coordinates (px)</span>
                        <button
                          type="button"
                          onClick={() => setCropRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })}
                          className="text-[11px] text-emerald-800 hover:underline"
                        >
                          Reset Box
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 text-xs">
                        <label>
                          X
                          <input
                            type="number"
                            value={cropPxPreview.x}
                            onChange={(e) => {
                              const nx = Math.max(0, Math.min(0.9, Number(e.target.value) / natDims.w));
                              setCropRect((r) => ({ ...r, x: nx, width: Math.min(r.width, 1 - nx) }));
                            }}
                            className="mt-1 w-full px-1.5 py-1 border border-slate-200 rounded font-mono text-xs"
                          />
                        </label>
                        <label>
                          Y
                          <input
                            type="number"
                            value={cropPxPreview.y}
                            onChange={(e) => {
                              const ny = Math.max(0, Math.min(0.9, Number(e.target.value) / natDims.h));
                              setCropRect((r) => ({ ...r, y: ny, height: Math.min(r.height, 1 - ny) }));
                            }}
                            className="mt-1 w-full px-1.5 py-1 border border-slate-200 rounded font-mono text-xs"
                          />
                        </label>
                        <label>
                          W
                          <input
                            type="number"
                            value={cropPxPreview.w}
                            onChange={(e) => {
                              const nw = Math.max(0.05, Math.min(1 - cropRect.x, Number(e.target.value) / natDims.w));
                              setCropRect((r) => ({ ...r, width: nw }));
                            }}
                            className="mt-1 w-full px-1.5 py-1 border border-slate-200 rounded font-mono text-xs"
                          />
                        </label>
                        <label>
                          H
                          <input
                            type="number"
                            value={cropPxPreview.h}
                            onChange={(e) => {
                              const nh = Math.max(0.05, Math.min(1 - cropRect.y, Number(e.target.value) / natDims.h));
                              setCropRect((r) => ({ ...r, height: nh }));
                            }}
                            className="mt-1 w-full px-1.5 py-1 border border-slate-200 rounded font-mono text-xs"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyShapeCrop}
                        disabled={busy}
                        className="w-full mt-1 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg"
                      >
                        {busy ? 'Applying Crop...' : 'Apply Crop to Image'}
                      </button>
                    </div>
                  </>
                )}

                {/* Orientation & Handwritten Signature */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                  <div className="text-xs font-semibold text-slate-900">Rotate, Flip & Signature</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          rotation: ((p.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                        }));
                      }}
                      className="flex items-center justify-center gap-1 py-2 px-2 text-xs font-medium bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      90°
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({ ...p, flipH: !p.flipH }));
                      }}
                      className={`flex items-center justify-center py-2 border rounded-lg text-xs ${
                        params.flipH ? 'bg-emerald-50 border-emerald-600 text-emerald-900' : 'bg-slate-50 border-slate-200'
                      }`}
                      title="Flip Horizontal"
                    >
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({ ...p, flipV: !p.flipV }));
                      }}
                      className={`flex items-center justify-center py-2 border rounded-lg text-xs ${
                        params.flipV ? 'bg-emerald-50 border-emerald-600 text-emerald-900' : 'bg-slate-50 border-slate-200'
                      }`}
                      title="Flip Vertical"
                    >
                      <FlipVertical2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSignMode((s) => !s)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium border rounded-lg transition-colors ${
                      signMode
                        ? 'bg-emerald-800 border-emerald-800 text-white'
                        : 'bg-white border-slate-200 hover:border-emerald-600 text-slate-800'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    Handwritten Signature Overlay
                  </button>
                </div>
              </div>
            )}

            {/* RESIZE & MANUAL FILE SIZE FEED TAB */}
            {studioTab === 'resize' && (
              <div className="space-y-4">
                {/* Manual Target File Size (KB / MB) Feed */}
                <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">Manual File Size Feed (Target KB / MB)</div>
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      Current size: <strong className="text-slate-800">{formatBytes(workingBytes)}</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      step="any"
                      value={targetSizeVal}
                      onChange={(e) => setTargetSizeVal(e.target.value)}
                      placeholder="e.g. 50"
                      aria-label="Target file size amount"
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
                    />
                    <select
                      value={targetSizeUnit}
                      onChange={(e) => setTargetSizeUnit(e.target.value as 'KB' | 'MB')}
                      aria-label="Target file size unit"
                      className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold bg-slate-50"
                    >
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '20 KB', val: '20', unit: 'KB' as const },
                      { label: '50 KB', val: '50', unit: 'KB' as const },
                      { label: '100 KB', val: '100', unit: 'KB' as const },
                      { label: '200 KB', val: '200', unit: 'KB' as const },
                      { label: '500 KB', val: '500', unit: 'KB' as const },
                      { label: '1 MB', val: '1', unit: 'MB' as const },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setTargetSizeVal(preset.val);
                          setTargetSizeUnit(preset.unit);
                        }}
                        className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-emerald-50 hover:text-emerald-900 rounded-md border border-slate-200"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <label className="block text-xs text-slate-600">
                    Output Format
                    <select
                      value={resizeFormat}
                      onChange={(e) =>
                        setResizeFormat(e.target.value as 'image/jpeg' | 'image/png' | 'image/webp')
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs"
                    >
                      <option value="image/jpeg">JPEG (Best for exact KB limits)</option>
                      <option value="image/webp">WEBP (High compression sharpness)</option>
                      <option value="image/png">PNG (Lossless transparency)</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={handleApplyManualTargetSize}
                    disabled={busy}
                    className="w-full py-2.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg"
                  >
                    {busy ? 'Compressing to Target...' : `Resize Under ${targetSizeVal || '0'} ${targetSizeUnit}`}
                  </button>
                </div>

                {/* Manual Pixel / Physical Dimensions Feed */}
                <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">
                      Manual Dimensions Feed (W × H)
                    </span>
                    <button
                      type="button"
                      onClick={() => setLockAspect((v) => !v)}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border ${
                        lockAspect
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      {lockAspect ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
                      {lockAspect ? 'Ratio Locked' : 'Unlocked'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label>
                      Unit
                      <select
                        value={dimUnit}
                        onChange={(e) => setDimUnit(e.target.value as 'px' | 'mm' | 'cm' | 'in')}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs"
                      >
                        <option value="px">Pixels (px)</option>
                        <option value="mm">Millimeters (mm)</option>
                        <option value="cm">Centimeters (cm)</option>
                        <option value="in">Inches (in)</option>
                      </select>
                    </label>
                    <label>
                      DPI (Print / Portal)
                      <select
                        value={dpi}
                        onChange={(e) => setDpi(Number(e.target.value))}
                        disabled={dimUnit === 'px'}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs disabled:opacity-50"
                      >
                        <option value={72}>72 DPI</option>
                        <option value={96}>96 DPI</option>
                        <option value={150}>150 DPI</option>
                        <option value={200}>200 DPI</option>
                        <option value={300}>300 DPI</option>
                        <option value={600}>600 DPI</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label>
                      Width ({dimUnit})
                      <input
                        type="number"
                        step="any"
                        value={manualWidthInput}
                        onChange={(e) => handleManualWidthChange(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono text-xs"
                      />
                    </label>
                    <label>
                      Height ({dimUnit})
                      <input
                        type="number"
                        step="any"
                        value={manualHeightInput}
                        onChange={(e) => handleManualHeightChange(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono text-xs"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'Passport 35×45mm', unit: 'mm' as const, w: '35', h: '45', d: 300 },
                      { label: 'Exam Sign 140×60px', unit: 'px' as const, w: '140', h: '60', d: 300 },
                      { label: 'Visa 2×2 in', unit: 'in' as const, w: '2', h: '2', d: 300 },
                      { label: 'Full HD', unit: 'px' as const, w: '1920', h: '1080', d: 96 },
                    ].map((pr) => (
                      <button
                        key={pr.label}
                        type="button"
                        onClick={() => {
                          setLockAspect(false);
                          setDimUnit(pr.unit);
                          setDpi(pr.d);
                          setManualWidthInput(pr.w);
                          setManualHeightInput(pr.h);
                        }}
                        className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-emerald-50 hover:text-emerald-900 rounded-md border border-slate-200"
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyManualDimensionsOnly}
                    disabled={busy}
                    className="w-full py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
                  >
                    {busy ? 'Resizing...' : 'Apply Manual Dimensions'}
                  </button>
                </div>
              </div>
            )}

            {/* CLEAN & SCAN TAB */}
            {studioTab === 'clean' && (
              <div className="space-y-4">
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-emerald-700" />
                    Document & Image Clean Tool
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'color',
                          cleanStrength: 78,
                          shadowRemoval: 72,
                          denoise: true,
                          contrast: 18,
                          brightness: 6,
                          sharpness: 35,
                        }));
                      }}
                      className="py-1.5 px-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg"
                    >
                      Auto Clean Page
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'bw',
                          cleanStrength: 95,
                          shadowRemoval: 90,
                          denoise: true,
                          contrast: 28,
                          brightness: 10,
                          sharpness: 45,
                        }));
                      }}
                      className="py-1.5 px-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
                    >
                      Deep Stain Clean
                    </button>
                  </div>
                  <label className="block pt-1">
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>Paper Clean & Whiten</span>
                      <span className="font-mono tabular-nums text-slate-800">
                        {params.cleanStrength || 0}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={params.cleanStrength || 0}
                      onChange={(e) => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({ ...p, cleanStrength: Number(e.target.value) }));
                      }}
                      className="w-full accent-emerald-700"
                    />
                  </label>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    Document Filter Mode
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {filterModes.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setPreserveExactWorkingBytes(false);
                          setParams((p) => ({ ...p, filterMode: m.id }));
                        }}
                        className={`py-2 px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                          params.filterMode === m.id
                            ? 'bg-emerald-800 border-emerald-800 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                      Enhancement
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams({ ...DEFAULT_ADJUSTMENTS, maxWidth: 1600 });
                      }}
                      className="text-[11px] text-emerald-800 hover:underline"
                    >
                      Reset
                    </button>
                  </div>

                  {(
                    [
                      { key: 'brightness', label: 'Brightness', min: -60, max: 60 },
                      { key: 'contrast', label: 'Contrast', min: -60, max: 80 },
                      { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
                      { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
                      { key: 'shadowRemoval', label: 'Shadow Cleanup', min: 0, max: 100 },
                    ] as const
                  ).map((slider) => (
                    <label key={slider.key} className="block">
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>{slider.label}</span>
                        <span className="font-mono tabular-nums text-slate-800">{params[slider.key]}</span>
                      </div>
                      <input
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        value={params[slider.key]}
                        onChange={(e) => {
                          setPreserveExactWorkingBytes(false);
                          setParams((p) => ({ ...p, [slider.key]: Number(e.target.value) }));
                        }}
                        className="w-full accent-emerald-700"
                      />
                    </label>
                  ))}

                  <label className="flex items-center justify-between text-xs text-slate-700 pt-1">
                    <span>Dust & Noise Reduction</span>
                    <input
                      type="checkbox"
                      checked={params.denoise}
                      onChange={(e) => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({ ...p, denoise: e.target.checked }));
                      }}
                      className="accent-emerald-700 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* BEAUTY TOOL TAB */}
            {studioTab === 'beauty' && (
              <div className="space-y-4">
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    Photo & Portrait Beauty Presets
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'original',
                          skinSmooth: 55,
                          warmth: 12,
                          glow: 38,
                          vignette: 18,
                          saturation: 10,
                          brightness: 6,
                          contrast: 8,
                        }));
                      }}
                      className="py-2 px-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg"
                    >
                      Natural Glow
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'original',
                          skinSmooth: 48,
                          warmth: 6,
                          glow: 30,
                          vignette: 0,
                          shadowRemoval: 45,
                          brightness: 10,
                          contrast: 12,
                          sharpness: 25,
                        }));
                      }}
                      className="py-2 px-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
                    >
                      ID Photo Studio
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'original',
                          skinSmooth: 42,
                          warmth: 26,
                          glow: 44,
                          vignette: 32,
                          saturation: 14,
                        }));
                      }}
                      className="py-2 px-2 text-xs font-medium bg-white border border-slate-200 hover:border-emerald-700 text-slate-800 rounded-lg"
                    >
                      Warm Portrait
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({
                          ...p,
                          filterMode: 'original',
                          skinSmooth: 0,
                          warmth: 0,
                          glow: 0,
                          vignette: 0,
                          saturation: 0,
                          brightness: 0,
                          contrast: 0,
                        }));
                      }}
                      className="py-2 px-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg"
                    >
                      Clear Beauty
                    </button>
                  </div>
                </div>

                {(
                  [
                    { key: 'skinSmooth', label: 'Skin & Surface Smooth', min: 0, max: 100 },
                    { key: 'warmth', label: 'Tone Warmth / Cool', min: -50, max: 50 },
                    { key: 'glow', label: 'Radiant Glow', min: 0, max: 100 },
                    { key: 'vignette', label: 'Studio Vignette', min: 0, max: 100 },
                    { key: 'saturation', label: 'Color Vibrancy', min: -50, max: 80 },
                  ] as const
                ).map((slider) => (
                  <label key={slider.key} className="block">
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>{slider.label}</span>
                      <span className="font-mono tabular-nums text-slate-800">
                        {params[slider.key] ?? 0}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={slider.min}
                      max={slider.max}
                      value={params[slider.key] ?? 0}
                      onChange={(e) => {
                        setPreserveExactWorkingBytes(false);
                        setParams((p) => ({ ...p, [slider.key]: Number(e.target.value) }));
                      }}
                      className="w-full accent-emerald-700"
                    />
                  </label>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
