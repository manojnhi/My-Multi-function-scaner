import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Languages,
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
}

export function DocumentPreviewModal({
  document: doc,
  onClose,
  onEditImage,
  onOpenOcr,
  onShareDoc,
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

  const activeSrc = isPdf ? pdfPages[pageIdx] || '' : doc.dataUrl;

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Document Preview"
    >
      <div className="w-full max-w-6xl h-[90vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 truncate">{doc.title}</h2>
            <p className="text-xs text-slate-500 tabular-nums truncate">
              {doc.fileName} · {formatBytes(doc.sizeBytes)} · {doc.pageCount} page
              {doc.pageCount > 1 ? 's' : ''} · {doc.folder}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono tabular-nums px-1.5 text-slate-700 min-w-[46px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
              title="Reset zoom and pan"
              aria-label="Reset zoom"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            {!isPdf && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditImage(doc);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Edit
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenOcr(doc);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
            >
              <Languages className="w-3.5 h-3.5" />
              OCR Text
            </button>

            {onShareDoc && (
              <button
                type="button"
                onClick={() => onShareDoc(doc)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-900"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
              aria-label="Print document"
            >
              <Printer className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => downloadDataUrl(doc.dataUrl, doc.fileName)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          <div
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) =>
                Math.min(4, Math.max(0.5, Number((z + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))))
              );
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
            className={`flex-1 bg-slate-900 overflow-hidden flex flex-col items-center justify-center p-6 select-none ${
              zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
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
                className="max-h-[72vh] w-auto object-contain rounded shadow-xl transition-transform duration-75"
              />
            ) : (
              <div className="text-center text-slate-300 space-y-2">
                <FileText className="w-10 h-10 mx-auto text-emerald-400" />
                <p className="text-sm">Preview ready for download ({doc.fileName})</p>
              </div>
            )}

            {isPdf && pdfPages.length > 1 && (
              <div className="mt-4 flex items-center gap-3 bg-slate-800 px-3.5 py-1.5 rounded-lg text-xs text-white relative z-10">
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                  disabled={pageIdx === 0}
                  className="p-1 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono tabular-nums">
                  Page {pageIdx + 1} / {pdfPages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.min(pdfPages.length - 1, i + 1))}
                  disabled={pageIdx === pdfPages.length - 1}
                  className="p-1 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Extracted OCR Side Panel */}
          <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-200 bg-slate-50 p-4 overflow-y-auto shrink-0">
            <div className="text-xs font-semibold text-slate-800 mb-2">Metadata & Indexed Text</div>
            <dl className="text-xs space-y-1.5 text-slate-600 pb-4 border-b border-slate-200">
              <div className="flex justify-between">
                <dt>Source</dt>
                <dd className="font-medium text-slate-900">{doc.sourceDevice}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Format</dt>
                <dd className="font-mono text-slate-900">{doc.fileExtension.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Version</dt>
                <dd className="font-mono tabular-nums text-slate-900">v{doc.version}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Sync State</dt>
                <dd className="font-medium text-emerald-800 capitalize">{doc.syncStatus}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-800 mb-1.5">OCR Text</div>
              {doc.ocrText ? (
                <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
                  {doc.ocrText}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">
                  No OCR text extracted yet. Click OCR Text above to scan English or Hindi text.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

