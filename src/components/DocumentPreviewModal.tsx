import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Languages,
  Layers,
  Maximize2,
  Printer,
  Share2,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes } from '../services/db';
import { downloadDataUrl, pdfToImages } from '../services/pdfService';
import type { ScanDocument } from '../types';

interface DocumentPreviewModalProps {
  document: ScanDocument;
  onClose: () => void;
  onEditImage: (doc: ScanDocument) => void;
  onOpenOcr: (doc: ScanDocument) => void;
  onShareDoc?: (doc: ScanDocument) => void;
  onDownloadDoc?: (doc: ScanDocument) => void;
  onOpenDocPages?: (doc: ScanDocument) => void;
}

export function DocumentPreviewModal({
  document: doc,
  onClose,
  onEditImage,
  onOpenOcr,
  onShareDoc,
  onDownloadDoc,
  onOpenDocPages,
}: DocumentPreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const isPdf = doc.mimeType === 'application/pdf';

  useEffect(() => {
    let active = true;
    if (isPdf) {
      setLoadingPdf(true);
      pdfToImages(doc.dataUrl, 1.5, 0.88)
        .then((imgs) => {
          if (active) setPdfPages(imgs);
        })
        .catch(() => {
          if (active) setPdfPages([]);
        })
        .finally(() => {
          if (active) setLoadingPdf(false);
        });
    }
    return () => {
      active = false;
    };
  }, [doc.dataUrl, isPdf]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activeSrc = isPdf ? pdfPages[pageIdx] || '' : doc.dataUrl;

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handlePrint = () => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc || !iframe.contentWindow) {
      iframe.remove();
      window.print();
      return;
    }

    const pagesToPrint = isPdf && pdfPages.length > 0 ? pdfPages : [doc.dataUrl];
    const body = frameDoc.body;
    body.style.margin = '0';
    body.style.padding = '16px';
    pagesToPrint.forEach((src) => {
      const img = frameDoc.createElement('img');
      img.src = src;
      img.style.width = '100%';
      img.style.maxWidth = '800px';
      img.style.display = 'block';
      img.style.margin = '0 auto 16px';
      body.appendChild(img);
    });

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 500);
    };
    window.setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      cleanup();
    }, 150);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0b0e14] text-white flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Document Preview"
    >
      {/* Minimal Modern Studio Header */}
      <header className="h-14 shrink-0 px-3 sm:px-5 bg-[#121721]/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-display font-semibold text-white truncate">
              {doc.title}
            </h2>
            <p className="text-[11px] text-slate-400 tabular-nums truncate">
              {formatBytes(doc.sizeBytes)} · {doc.pageCount} {doc.pageCount > 1 ? 'pages' : 'page'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => {
                const next = Math.max(0.5, Number((zoom - 0.25).toFixed(2)));
                setZoom(next);
                if (next <= 1) setPan({ x: 0, y: 0 });
              }}
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono tabular-nums px-2 text-slate-200 min-w-[46px] text-center select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
              title="Fit to screen"
              aria-label="Reset zoom"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="hidden sm:flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Full-Size Document Stage */}
      <div
        onWheel={(e) => {
          e.preventDefault();
          const next = Math.min(4, Math.max(0.5, Number((zoom + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))));
          setZoom(next);
          if (next <= 1) setPan({ x: 0, y: 0 });
        }}
        onDoubleClick={() => {
          if (zoom > 1) {
            resetView();
          } else {
            setZoom(2);
          }
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          setDragOrigin({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y });
        }}
        onPointerMove={(e) => {
          if (!dragOrigin) return;
          setPan({
            x: dragOrigin.px + (e.clientX - dragOrigin.x),
            y: dragOrigin.py + (e.clientY - dragOrigin.y),
          });
        }}
        onPointerUp={() => setDragOrigin(null)}
        onPointerLeave={() => setDragOrigin(null)}
        className={`relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center p-2 sm:p-6 select-none touch-none ${
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
        }`}
      >
        {loadingPdf ? (
          <div className="text-sm text-slate-300">Rendering PDF pages...</div>
        ) : activeSrc ? (
          <img
            src={activeSrc}
            alt={doc.title}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="w-full h-full object-contain rounded-lg drop-shadow-[0_20px_50px_rgba(0,0,0,0.65)] transition-transform duration-100"
          />
        ) : (
          <div className="text-center text-slate-300 space-y-2">
            <FileText className="w-12 h-12 mx-auto text-emerald-400" />
            <p className="text-sm">Preview ready for download</p>
          </div>
        )}

        {isPdf && pdfPages.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#151b26]/90 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-xl text-xs text-white shadow-lg">
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              disabled={pageIdx === 0}
              className="p-1 disabled:opacity-40 hover:text-emerald-400"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono tabular-nums">
              {pageIdx + 1} / {pdfPages.length}
            </span>
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.min(pdfPages.length - 1, i + 1))}
              disabled={pageIdx === pdfPages.length - 1}
              className="p-1 disabled:opacity-40 hover:text-emerald-400"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Sleek Professional Action Dock */}
      <footer className="shrink-0 bg-[#121721]/95 backdrop-blur-md border-t border-white/10 px-2 sm:px-6 py-2">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
          {onOpenDocPages && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDocPages(doc);
              }}
              className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-slate-100 whitespace-nowrap transition-colors"
            >
              <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Pages</span>
            </button>
          )}
          {!isPdf && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onEditImage(doc);
              }}
              className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-slate-100 whitespace-nowrap transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Edit</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenOcr(doc);
            }}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-slate-100 whitespace-nowrap transition-colors"
          >
            <Languages className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="sm:hidden">OCR</span>
            <span className="hidden sm:inline">OCR Text</span>
          </button>

          {onShareDoc && (
            <button
              type="button"
              onClick={() => onShareDoc(doc)}
              className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-slate-100 whitespace-nowrap transition-colors"
            >
              <Share2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Share</span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePrint}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-slate-100 whitespace-nowrap transition-colors"
            aria-label="Print document"
          >
            <Printer className="w-4 h-4 text-slate-300 shrink-0" />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onDownloadDoc ? onDownloadDoc(doc) : downloadDataUrl(doc.dataUrl, doc.fileName)
            }
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 min-h-[44px] px-1.5 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl whitespace-nowrap transition-colors shadow-sm"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span className="sm:hidden">Save</span>
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
