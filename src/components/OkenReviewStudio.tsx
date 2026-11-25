import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  FilePlus2,
  Loader2,
  Maximize,
  RotateCcw,
  ScanLine,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { removePageFromList, rotateCounterClockwise } from '../services/docViewMath';
import {
  applyStudioFilterPreset,
  detectDocumentCorners,
  warpPerspective,
} from '../services/imageProcessor';
import {
  defaultPaperCorners,
  getCropPreviewMetrics,
  type OkenScenePresetId,
  STUDIO_FILTER_PRESETS,
  type StudioFilterPresetId,
} from '../services/paperCropMath';
import type { CornerPoint, DocumentFilterMode } from '../types';

interface ReviewPage {
  rawUrl: string;
  croppedUrl: string;
  corners: CornerPoint[];
  rotation: 0 | 90 | 180 | 270;
  presetId: StudioFilterPresetId;
}

interface OkenReviewStudioProps {
  rawCaptureUrl: string;
  initialCroppedUrl: string;
  initialCorners: CornerPoint[];
  initialPreset?: OkenScenePresetId;
  title: string;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
  saveLabel?: string;
  onRetake: () => void;
  onConfirmSave: (result: {
    dataUrl: string;
    filterMode: DocumentFilterMode;
    presetId: OkenScenePresetId;
    title?: string;
    pages?: string[];
  }) => Promise<void>;
}

function mapLegacyPresetToStudio(preset?: OkenScenePresetId): StudioFilterPresetId {
  switch (preset) {
    case 'original':
      return 'original';
    case 'lighten':
      return 'lighten';
    case 'bw':
      return 'bw';
    case 'black':
      return 'grayscale';
    case 'hd-clear':
    case 'auto':
    default:
      return 'magic-color';
  }
}

export function OkenReviewStudio({
  rawCaptureUrl,
  initialCroppedUrl,
  initialCorners,
  initialPreset = 'auto',
  title: initialTitle,
  quality = 0.9,
  format = 'image/jpeg',
  onRetake,
  onConfirmSave,
}: OkenReviewStudioProps) {
  const [docTitle, setDocTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);

  const [pages, setPages] = useState<ReviewPage[]>([
    {
      rawUrl: rawCaptureUrl,
      croppedUrl: initialCroppedUrl,
      corners: initialCorners,
      rotation: 0,
      presetId: mapLegacyPresetToStudio(initialPreset),
    },
  ]);
  const [pageIdx, setPageIdx] = useState(0);
  const [applyToAll, setApplyToAll] = useState(false);

  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [activeCornerIdx, setActiveCornerIdx] = useState<number | null>(null);
  const [renderedPreviewUrl, setRenderedPreviewUrl] = useState(initialCroppedUrl);
  const [sceneThumbs, setSceneThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const addPageInputRef = useRef<HTMLInputElement | null>(null);
  const activePage = pages[pageIdx] || pages[0];

  // Generate real mini-thumbnails for the 6 dark studio filters
  useEffect(() => {
    if (!activePage) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const preset of STUDIO_FILTER_PRESETS) {
        try {
          const thumb = await applyStudioFilterPreset(activePage.croppedUrl, preset.id, {
            rotation: activePage.rotation,
            maxWidth: 160,
            quality: 0.72,
            format: 'image/jpeg',
          });
          if (cancelled) return;
          next[preset.id] = thumb.dataUrl;
        } catch {
          next[preset.id] = activePage.croppedUrl;
        }
      }
      if (!cancelled) setSceneThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [activePage.croppedUrl, activePage.rotation]);

  // Render full preview for active preset + rotation
  useEffect(() => {
    if (!activePage) return;
    let cancelled = false;
    setBusy(true);
    applyStudioFilterPreset(activePage.croppedUrl, activePage.presetId, {
      rotation: activePage.rotation,
      maxWidth: 1300,
      quality: 0.88,
      format,
    })
      .then((res) => {
        if (!cancelled) setRenderedPreviewUrl(res.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setRenderedPreviewUrl(activePage.croppedUrl);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePage.croppedUrl, activePage.presetId, activePage.rotation, format]);

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!adjustingCrop || activeCornerIdx === null || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const nx = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height));
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === pageIdx
          ? {
              ...p,
              corners: p.corners.map((pt, cIdx) => (cIdx === activeCornerIdx ? { x: nx, y: ny } : pt)),
            }
          : p
      )
    );
  };

  const handleApplyCrop = async () => {
    setBusy(true);
    try {
      const warped = await warpPerspective(activePage.rawUrl, activePage.corners, 1600);
      setPages((prev) =>
        prev.map((p, idx) => (idx === pageIdx ? { ...p, croppedUrl: warped.dataUrl } : p))
      );
      setAdjustingCrop(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        let croppedUrl = dataUrl;
        let detected = defaultPaperCorners();
        try {
          detected = await detectDocumentCorners(dataUrl);
          const warped = await warpPerspective(dataUrl, detected, 1600);
          croppedUrl = warped.dataUrl;
        } catch {
          // keep full frame
        }
        setPages((prev) => {
          const next: ReviewPage[] = [
            ...prev,
            {
              rawUrl: dataUrl,
              croppedUrl,
              corners: detected,
              rotation: 0,
              presetId: activePage.presetId,
            },
          ];
          setPageIdx(next.length - 1);
          return next;
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleDone = async () => {
    setSaving(true);
    try {
      const renderedPages: string[] = [];
      let lastFilterMode: DocumentFilterMode = 'color';
      for (const p of pages) {
        const effPreset = applyToAll ? activePage.presetId : p.presetId;
        const out = await applyStudioFilterPreset(p.croppedUrl, effPreset, {
          rotation: p.rotation,
          maxWidth: 1700,
          quality,
          format,
        });
        renderedPages.push(out.dataUrl);
        lastFilterMode = out.filterMode;
      }

      await onConfirmSave({
        dataUrl: renderedPages[0],
        filterMode: lastFilterMode,
        presetId: initialPreset,
        title: docTitle.trim() || initialTitle,
        pages: renderedPages.length > 1 ? renderedPages : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const cropMetrics = getCropPreviewMetrics(activePage.corners, 1200, 1600);

  return (
    <div className="flex flex-col h-full bg-[#121212] text-white overflow-hidden select-none">
      <input
        ref={addPageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleAddFiles}
        className="hidden"
      />

      {/* Top Bar matching Screenshot 3 */}
      <div className="h-14 flex items-center justify-between gap-2 px-3 bg-[#121212] shrink-0">
        <button
          type="button"
          onClick={onRetake}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 shrink-0"
          aria-label="Back to camera"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 flex items-center justify-center sm:justify-start">
          {editingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEditingTitle(false);
              }}
              className="w-full max-w-xs"
            >
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                className="w-full bg-white/10 border border-emerald-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
                aria-label="Edit scan title"
                autoFocus
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="text-base font-medium text-white border-b border-dashed border-white/75 pb-0.5 truncate max-w-full hover:text-emerald-300"
            >
              {docTitle}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleDone}
          disabled={saving}
          className="px-4 py-1.5 rounded-md bg-[#0d8a4b] hover:bg-emerald-500 text-white text-sm font-semibold min-h-[36px] inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>Done</span>
        </button>
      </div>

      {/* Main Stage */}
      <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center px-4 py-2 overflow-hidden bg-[#161616]">
        <div
          ref={stageRef}
          onPointerMove={handleStagePointerMove}
          onPointerUp={() => setActiveCornerIdx(null)}
          onPointerLeave={() => setActiveCornerIdx(null)}
          className="relative max-h-full max-w-full select-none touch-none flex items-center justify-center"
        >
          <img
            src={adjustingCrop ? activePage.rawUrl : renderedPreviewUrl}
            alt={docTitle}
            draggable={false}
            className="max-h-[calc(100vh-300px)] max-w-full w-auto object-contain rounded-[2px] shadow-2xl block"
          />

          {!adjustingCrop && (
            <button
              type="button"
              onClick={() => {
                if (pages.length <= 1) {
                  onRetake();
                } else {
                  const res = removePageFromList(pages, pageIdx);
                  setPages(res.nextPages);
                  setPageIdx(res.nextIndex);
                }
              }}
              className="absolute -top-2 -left-2 sm:top-2 sm:left-2 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-slate-800 flex items-center justify-center shadow-md z-10"
              aria-label="Discard page"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {adjustingCrop && (
            <>
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={activePage.corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                  fill="rgba(13, 138, 75, 0.16)"
                  stroke="#10b981"
                  strokeWidth="0.7"
                />
              </svg>
              {activePage.corners.map((c, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Adjust paper corner ${idx + 1}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setActiveCornerIdx(idx);
                  }}
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-emerald-500/90 border-2 border-white shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <span className="w-2 h-2 rounded-full bg-white" />
                </button>
              ))}
            </>
          )}
        </div>

        {/* < 1/N > counter */}
        {!adjustingCrop && (
          <div className="mt-2.5 flex items-center gap-4 text-xs text-slate-300">
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              disabled={pageIdx === 0}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono tabular-nums text-sm text-white">
              {pageIdx + 1}/{pages.length}
            </span>
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
              disabled={pageIdx >= pages.length - 1}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {busy && (
          <div className="absolute top-3 right-3 bg-black/75 border border-white/10 px-2.5 py-1 rounded-lg text-[11px] text-emerald-300 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Rendering...
          </div>
        )}
      </div>

      {/* Crop Mode Controls OR Dark Studio Filter Strip + Bottom Bar */}
      {adjustingCrop ? (
        <div className="px-4 py-3 bg-[#101216] border-t border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const detected = await detectDocumentCorners(activePage.rawUrl);
                setPages((prev) =>
                  prev.map((p, idx) => (idx === pageIdx ? { ...p, corners: detected } : p))
                );
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white min-h-[38px]"
            >
              <ScanLine className="w-3.5 h-3.5 text-emerald-400" />
              Auto Paper ({cropMetrics.aspectLabel})
            </button>
            <button
              type="button"
              onClick={() =>
                setPages((prev) =>
                  prev.map((p, idx) =>
                    idx === pageIdx
                      ? {
                          ...p,
                          corners: [
                            { x: 0.02, y: 0.02 },
                            { x: 0.98, y: 0.02 },
                            { x: 0.98, y: 0.98 },
                            { x: 0.02, y: 0.98 },
                          ],
                        }
                      : p
                  )
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white min-h-[38px]"
            >
              <Maximize className="w-3.5 h-3.5 text-slate-300" />
              Full
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAdjustingCrop(false)}
              className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyCrop}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0d8a4b] hover:bg-emerald-500 text-xs font-semibold text-white min-h-[38px]"
            >
              <Check className="w-4 h-4" />
              Crop Paper
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-[#121212] shrink-0">
          {/* Apply to all pages toggle */}
          <div className="flex justify-end px-3 pb-1.5">
            <button
              type="button"
              onClick={() => setApplyToAll((v) => !v)}
              role="switch"
              aria-checked={applyToAll}
              className="inline-flex items-center gap-2.5 bg-black/75 border border-white/10 rounded-full px-3.5 py-1.5 text-xs text-white"
            >
              <span>Apply to all pages</span>
              <span
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  applyToAll ? 'border-emerald-400 bg-emerald-500' : 'border-white/75'
                }`}
              >
                {applyToAll && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
            </button>
          </div>

          {/* 6-Filter Thumbnail Strip */}
          <div className="px-3 py-2 flex items-center gap-2.5 overflow-x-auto bg-[#0c0c0c]">
            {STUDIO_FILTER_PRESETS.map((preset) => {
              const selected = activePage.presetId === preset.id;
              const thumbSrc = sceneThumbs[preset.id] || activePage.croppedUrl;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setPages((prev) =>
                      prev.map((p, idx) =>
                        applyToAll || idx === pageIdx ? { ...p, presetId: preset.id } : p
                      )
                    )
                  }
                  className={`relative shrink-0 w-[76px] rounded-sm overflow-hidden border-2 transition-all text-center ${
                    selected ? 'border-[#0d8a4b]' : 'border-transparent hover:border-white/30'
                  }`}
                >
                  <div className="relative h-14 w-full bg-slate-800 overflow-hidden">
                    <img
                      src={thumbSrc}
                      alt={preset.label}
                      className="w-full h-full object-cover"
                    />
                    {preset.badge && (
                      <span className="absolute top-0 right-0 bg-[#f97316] text-white text-[9px] font-bold px-1.5 py-0.5 leading-none rounded-bl">
                        {preset.badge}
                      </span>
                    )}
                  </div>
                  <div
                    className={`py-0.5 px-0.5 text-[10.5px] tracking-tight font-medium whitespace-nowrap ${
                      selected ? 'bg-[#0d8a4b] text-white' : 'bg-black/75 text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bottom 4-Button Bar: Retake · Add · Left · Crop */}
          <div className="h-14 bg-black border-t border-white/10 grid grid-cols-4 items-center">
            <button
              type="button"
              onClick={onRetake}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400"
            >
              <Camera className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Retake</span>
            </button>
            <button
              type="button"
              onClick={() => addPageInputRef.current?.click()}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400"
            >
              <FilePlus2 className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Add</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setPages((prev) =>
                  prev.map((p, idx) =>
                    idx === pageIdx
                      ? { ...p, rotation: rotateCounterClockwise(p.rotation) }
                      : p
                  )
                )
              }
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400"
            >
              <RotateCcw className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Left</span>
            </button>
            <button
              type="button"
              onClick={() => setAdjustingCrop(true)}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400"
            >
              <Crop className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Crop</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
