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
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  mapDocumentFilterToStudioPreset,
  removePageFromList,
  rotateCounterClockwise,
} from '../services/docViewMath';
import {
  applyStudioFilterPreset,
  detectDocumentCorners,
  getDataUrlByteLength,
  warpPerspective,
} from '../services/imageProcessor';
import {
  defaultPaperCorners,
  STUDIO_FILTER_PRESETS,
  type StudioFilterPresetId,
} from '../services/paperCropMath';
import { pdfToImages } from '../services/pdfService';
import type { CornerPoint, DocumentFilterMode, ScanDocument } from '../types';

interface PageDraft {
  id: string;
  baseUrl: string;
  rotation: 0 | 90 | 180 | 270;
  presetId: StudioFilterPresetId;
  corners: CornerPoint[];
}

interface ScanPageStudioModalProps {
  document: ScanDocument;
  initialPageIndex?: number;
  onClose: () => void;
  onSaveDocumentPages: (result: {
    title: string;
    pages: string[];
    primaryDataUrl: string;
    filterMode: DocumentFilterMode;
    sizeBytes: number;
  }) => Promise<void>;
  onDeleteDocument?: (docId: string) => Promise<void>;
  onRequestRetakeCamera?: (pageIndex: number) => void;
  onRequestAddCamera?: () => void;
}

export function ScanPageStudioModal({
  document: doc,
  initialPageIndex = 0,
  onClose,
  onSaveDocumentPages,
  onDeleteDocument,
  onRequestRetakeCamera,
  onRequestAddCamera,
}: ScanPageStudioModalProps) {
  const defaultPreset = mapDocumentFilterToStudioPreset(doc.filterMode);

  const [title, setTitle] = useState(doc.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [pageIdx, setPageIdx] = useState(initialPageIndex);
  const [applyToAll, setApplyToAll] = useState(false);

  const [renderedStageUrl, setRenderedStageUrl] = useState('');
  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(false);

  // Interactive 4-corner Crop mode
  const [cropping, setCropping] = useState(false);
  const [activeCornerIdx, setActiveCornerIdx] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // File pickers for Retake / Add Page
  const retakeFileRef = useRef<HTMLInputElement | null>(null);
  const addFileRef = useRef<HTMLInputElement | null>(null);
  const [showAddChoice, setShowAddChoice] = useState<'retake' | 'add' | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingPages(true);
      try {
        let initialUrls: string[] = [];
        if (doc.pages && doc.pages.length > 0) {
          initialUrls = doc.pages;
        } else if (doc.mimeType === 'application/pdf') {
          initialUrls = await pdfToImages(doc.dataUrl, 1.6, 0.9);
        } else {
          initialUrls = [doc.dataUrl];
        }
        if (!active) return;
        const drafts: PageDraft[] = initialUrls.map((url, idx) => ({
          id: `${doc.id}_p_${idx}_${Date.now()}`,
          baseUrl: url,
          rotation: 0,
          presetId: defaultPreset,
          corners: defaultPaperCorners(),
        }));
        setPages(drafts);
        setPageIdx(Math.max(0, Math.min(drafts.length - 1, initialPageIndex)));
      } catch {
        if (!active) return;
        setPages([
          {
            id: `${doc.id}_p_0`,
            baseUrl: doc.dataUrl,
            rotation: 0,
            presetId: defaultPreset,
            corners: defaultPaperCorners(),
          },
        ]);
        setPageIdx(0);
      } finally {
        if (active) setLoadingPages(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [doc.id, doc.dataUrl, doc.mimeType, doc.pages, defaultPreset, initialPageIndex]);

  const activePage = pages[pageIdx];

  // Generate real mini-thumbnails for the 6 studio filters when active page changes
  useEffect(() => {
    if (!activePage) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const preset of STUDIO_FILTER_PRESETS) {
        try {
          const thumb = await applyStudioFilterPreset(activePage.baseUrl, preset.id, {
            rotation: activePage.rotation,
            maxWidth: 160,
            quality: 0.72,
            format: 'image/jpeg',
          });
          if (cancelled) return;
          next[preset.id] = thumb.dataUrl;
        } catch {
          next[preset.id] = activePage.baseUrl;
        }
      }
      if (!cancelled) setFilterThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [activePage?.id, activePage?.baseUrl, activePage?.rotation]);

  // Render main preview stage for active page
  useEffect(() => {
    if (!activePage) return;
    let cancelled = false;
    setBusy(true);
    applyStudioFilterPreset(activePage.baseUrl, activePage.presetId, {
      rotation: activePage.rotation,
      maxWidth: 1400,
      quality: 0.88,
      format: 'image/jpeg',
    })
      .then((res) => {
        if (!cancelled) setRenderedStageUrl(res.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setRenderedStageUrl(activePage.baseUrl);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePage?.id, activePage?.baseUrl, activePage?.presetId, activePage?.rotation]);

  const handleSelectFilter = (presetId: StudioFilterPresetId) => {
    setPages((prev) =>
      prev.map((p, idx) =>
        applyToAll || idx === pageIdx ? { ...p, presetId } : p
      )
    );
  };

  const handleRotateLeft = () => {
    if (!activePage) return;
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === pageIdx ? { ...p, rotation: rotateCounterClockwise(p.rotation) } : p
      )
    );
  };

  const handleTrashPage = async () => {
    if (pages.length <= 1) {
      setConfirmDeleteDoc(true);
      return;
    }
    const { nextPages, nextIndex } = removePageFromList(pages, pageIdx);
    setPages(nextPages);
    setPageIdx(nextIndex);
  };

  const handleOpenCropMode = async () => {
    if (!activePage) return;
    setCropping(true);
    try {
      const detected = await detectDocumentCorners(activePage.baseUrl);
      setPages((prev) =>
        prev.map((p, idx) => (idx === pageIdx ? { ...p, corners: detected } : p))
      );
    } catch {
      // keep existing corners
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropping || activeCornerIdx === null || !stageRef.current || !activePage) return;
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
    if (!activePage) return;
    setBusy(true);
    try {
      const warped = await warpPerspective(activePage.baseUrl, activePage.corners, 1700);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === pageIdx
            ? { ...p, baseUrl: warped.dataUrl, corners: defaultPaperCorners() }
            : p
        )
      );
      setCropping(false);
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceWithFile = (e: React.ChangeEvent<HTMLInputElement>, mode: 'retake' | 'add') => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, fIdx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        if (mode === 'retake' && fIdx === 0) {
          setPages((prev) =>
            prev.map((p, idx) =>
              idx === pageIdx
                ? {
                    ...p,
                    baseUrl: dataUrl,
                    rotation: 0,
                    corners: defaultPaperCorners(),
                  }
                : p
            )
          );
        } else {
          const newDraft: PageDraft = {
            id: `${doc.id}_add_${Date.now()}_${fIdx}`,
            baseUrl: dataUrl,
            rotation: 0,
            presetId: activePage?.presetId || 'magic-color',
            corners: defaultPaperCorners(),
          };
          setPages((prev) => {
            const next = [...prev, newDraft];
            setPageIdx(next.length - 1);
            return next;
          });
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
    setShowAddChoice(null);
  };

  const handleDone = async () => {
    if (pages.length === 0) return;
    setSaving(true);
    try {
      const renderedUrls: string[] = [];
      let lastFilterMode: DocumentFilterMode = 'color';

      for (const p of pages) {
        const effectivePreset = applyToAll && activePage ? activePage.presetId : p.presetId;
        const out = await applyStudioFilterPreset(p.baseUrl, effectivePreset, {
          rotation: p.rotation,
          maxWidth: 1700,
          quality: 0.9,
          format: 'image/jpeg',
        });
        renderedUrls.push(out.dataUrl);
        lastFilterMode = out.filterMode;
      }

      const primary = renderedUrls[0];
      const totalBytes = renderedUrls.reduce((sum, u) => sum + getDataUrlByteLength(u), 0);

      await onSaveDocumentPages({
        title: title.trim() || doc.title,
        pages: renderedUrls,
        primaryDataUrl: primary,
        filterMode: lastFilterMode,
        sizeBytes: totalBytes,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#121212] text-white flex flex-col overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Page Filter & Crop Studio"
    >
      {/* Hidden File Inputs */}
      <input
        ref={retakeFileRef}
        type="file"
        accept="image/*"
        onChange={(e) => handleReplaceWithFile(e, 'retake')}
        className="hidden"
      />
      <input
        ref={addFileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleReplaceWithFile(e, 'add')}
        className="hidden"
      />

      {/* Top Dark Studio Header (Screenshot 3) */}
      <header className="h-14 px-3 sm:px-5 bg-[#121212] flex items-center justify-between gap-3 shrink-0 z-20">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors shrink-0"
          aria-label="Back"
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
              className="w-full max-w-sm"
            >
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                className="w-full bg-white/10 border border-emerald-500 rounded px-2.5 py-1 text-sm font-medium text-white focus:outline-none"
                aria-label="Edit document title"
                autoFocus
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="text-base font-medium text-white border-b border-dashed border-white/75 pb-0.5 truncate max-w-full hover:text-emerald-300 transition-colors text-left"
              title="Tap to rename document"
            >
              {title}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleDone}
          disabled={saving || loadingPages || !activePage}
          className="px-4 py-1.5 rounded-md bg-[#0d8a4b] hover:bg-emerald-500 text-white text-sm font-semibold min-h-[36px] inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60 transition-colors"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>Done</span>
        </button>
      </header>

      {/* Main Dark Document Stage */}
      <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center px-4 py-2 bg-[#161616] overflow-hidden">
        {loadingPages || !activePage ? (
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            Loading page...
          </div>
        ) : (
          <div
            ref={stageRef}
            onPointerMove={handleStagePointerMove}
            onPointerUp={() => setActiveCornerIdx(null)}
            onPointerLeave={() => setActiveCornerIdx(null)}
            className="relative max-h-full max-w-full flex items-center justify-center touch-none"
          >
            <img
              src={cropping ? activePage.baseUrl : renderedStageUrl || activePage.baseUrl}
              alt={title}
              draggable={false}
              className="max-h-[calc(100vh-300px)] max-w-full w-auto object-contain rounded-[2px] shadow-2xl block"
            />

            {/* Floating Circular Trash Button at top-left of document (Screenshot 3) */}
            {!cropping && (
              <button
                type="button"
                onClick={handleTrashPage}
                className="absolute -top-2 -left-2 sm:top-2 sm:left-2 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-slate-800 flex items-center justify-center shadow-md transition-colors z-10"
                aria-label={pages.length > 1 ? `Delete page ${pageIdx + 1}` : 'Delete document'}
                title={pages.length > 1 ? 'Delete this page' : 'Delete document'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            {/* 4-Corner Perspective Crop Polygon */}
            {cropping && (
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
                    aria-label={`Adjust corner ${idx + 1}`}
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
        )}

        {/* Inline Page Counter (< 1/1 >) matching Screenshot 3 */}
        {!cropping && pages.length > 0 && (
          <div className="mt-2.5 flex items-center gap-4 text-xs text-slate-300">
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              disabled={pageIdx === 0}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center transition-colors"
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
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-35 flex items-center justify-center transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {busy && !cropping && (
          <div className="absolute top-3 right-3 bg-black/75 border border-white/10 px-2.5 py-1 rounded-lg text-[11px] text-emerald-300 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Applying...
          </div>
        )}

        {/* Confirm Whole-Document Delete Banner */}
        {confirmDeleteDoc && (
          <div className="absolute inset-x-4 bottom-4 mx-auto max-w-sm bg-[#1f242c] border border-white/15 rounded-xl p-3.5 shadow-2xl z-30 space-y-2.5">
            <div className="text-xs font-semibold text-white">
              Delete "{title}" permanently?
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteDoc(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onDeleteDocument) {
                    await onDeleteDocument(doc.id);
                  }
                  setConfirmDeleteDoc(false);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Quick Retake / Add Source Sheet */}
        {showAddChoice && (
          <div className="absolute inset-x-4 bottom-4 mx-auto max-w-sm bg-[#1f242c] border border-white/15 rounded-2xl p-4 shadow-2xl z-30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                {showAddChoice === 'retake' ? 'Retake Current Page' : 'Add New Page'}
              </span>
              <button
                type="button"
                onClick={() => setShowAddChoice(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const action = showAddChoice;
                  setShowAddChoice(null);
                  if (action === 'retake' && onRequestRetakeCamera) {
                    onClose();
                    onRequestRetakeCamera(pageIdx);
                  } else if (action === 'add' && onRequestAddCamera) {
                    onClose();
                    onRequestAddCamera();
                  } else {
                    retakeFileRef.current?.click();
                  }
                }}
                className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
              >
                <Camera className="w-4 h-4 text-emerald-400" />
                Use Camera
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showAddChoice === 'retake') retakeFileRef.current?.click();
                  else addFileRef.current?.click();
                }}
                className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
              >
                <Upload className="w-4 h-4 text-emerald-400" />
                Upload Image
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Crop Actions OR Filter Strip + Bottom 4-Button Toolbar */}
      {cropping && activePage ? (
        <div className="px-4 py-3 bg-[#101216] border-t border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const detected = await detectDocumentCorners(activePage.baseUrl);
                setPages((prev) =>
                  prev.map((p, idx) => (idx === pageIdx ? { ...p, corners: detected } : p))
                );
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
            >
              <ScanLine className="w-3.5 h-3.5 text-emerald-400" />
              Auto Paper
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
            >
              <Maximize className="w-3.5 h-3.5 text-slate-300" />
              Full
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCropping(false)}
              className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyCrop}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0d8a4b] hover:bg-emerald-500 text-xs font-semibold text-white"
            >
              <Check className="w-4 h-4" />
              Apply Crop
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 bg-[#121212]">
          {/* Apply to all pages toggle row (Screenshot 3) */}
          <div className="flex justify-end px-3 pb-1.5">
            <button
              type="button"
              onClick={() => setApplyToAll((v) => !v)}
              role="switch"
              aria-checked={applyToAll}
              className="inline-flex items-center gap-2.5 bg-black/75 border border-white/10 rounded-full px-3.5 py-1.5 text-xs text-white hover:bg-black transition-colors"
            >
              <span>Apply to all pages</span>
              <span
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                  applyToAll ? 'border-emerald-400 bg-emerald-500' : 'border-white/75'
                }`}
              >
                {applyToAll && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
            </button>
          </div>

          {/* 6-Filter Thumbnail Strip (No shadow [Beta], Original, Lighten, Magic Color, Grayscale, B&W) */}
          <div className="px-3 py-2 flex items-center gap-2.5 overflow-x-auto bg-[#0c0c0c]">
            {STUDIO_FILTER_PRESETS.map((preset) => {
              const selected = activePage?.presetId === preset.id;
              const thumbSrc = filterThumbs[preset.id] || activePage?.baseUrl;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectFilter(preset.id)}
                  className={`relative shrink-0 w-[76px] rounded-sm overflow-hidden border-2 transition-all text-center ${
                    selected
                      ? 'border-[#0d8a4b]'
                      : 'border-transparent hover:border-white/30'
                  }`}
                >
                  <div className="relative h-14 w-full bg-slate-800 overflow-hidden">
                    {thumbSrc && (
                      <img
                        src={thumbSrc}
                        alt={preset.label}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {preset.badge && (
                      <span className="absolute top-0 right-0 bg-[#f97316] text-white text-[9px] font-bold px-1.5 py-0.5 leading-none rounded-bl">
                        {preset.badge}
                      </span>
                    )}
                  </div>
                  <div
                    className={`py-0.5 px-0.5 text-[10.5px] tracking-tight font-medium whitespace-nowrap ${
                      selected
                        ? 'bg-[#0d8a4b] text-white'
                        : 'bg-black/75 text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bottom 4-Button Toolbar: Retake · Add · Left · Crop (Screenshot 3) */}
          <div className="h-14 bg-black border-t border-white/10 grid grid-cols-4 items-center">
            <button
              type="button"
              onClick={() => setShowAddChoice('retake')}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400 transition-colors"
            >
              <Camera className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Retake</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddChoice('add')}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400 transition-colors"
            >
              <FilePlus2 className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Add</span>
            </button>

            <button
              type="button"
              onClick={handleRotateLeft}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400 transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">Left</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCropMode}
              className="flex flex-col items-center justify-center h-full text-slate-100 hover:text-emerald-400 transition-colors"
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
