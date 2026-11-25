import { Check, Download, FileText, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../services/db';
import {
  buildExportFileName,
  type DownloadFormatId,
  getAvailableDownloadFormats,
  getDefaultDownloadFormat,
} from '../services/documentExportMath';
import { exportDocumentInFormat } from '../services/documentExportService';
import type { ScanDocument } from '../types';

interface DownloadFormatModalProps {
  document: ScanDocument;
  onClose: () => void;
  onDownloaded?: (message: string) => void;
}

const QUALITY_OPTIONS = [
  { id: 'compact', label: 'Compact', value: 0.68, note: 'Smaller file' },
  { id: 'standard', label: 'Standard', value: 0.85, note: 'Balanced' },
  { id: 'hd', label: 'HD High', value: 0.95, note: 'Max clarity' },
] as const;

export function DownloadFormatModal({
  document: doc,
  onClose,
  onDownloaded,
}: DownloadFormatModalProps) {
  const formats = useMemo(
    () =>
      getAvailableDownloadFormats({
        mimeType: doc.mimeType,
        pageCount: doc.pageCount,
        pages: doc.pages,
        ocrText: doc.ocrText,
      }),
    [doc.mimeType, doc.ocrText, doc.pageCount, doc.pages]
  );

  const [selectedFormat, setSelectedFormat] = useState<DownloadFormatId>(() =>
    getDefaultDownloadFormat({ mimeType: doc.mimeType, pageCount: doc.pageCount })
  );
  const [quality, setQuality] = useState<number>(0.85);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exporting, onClose]);

  const activeOption = formats.find((f) => f.id === selectedFormat) || formats[0];
  const previewFileName =
    selectedFormat === 'long-jpg'
      ? `${(doc.fileName || doc.title).replace(/\.[^/.]+$/, '')}_long.jpg`
      : buildExportFileName(doc.fileName || doc.title, activeOption.ext);

  const showQuality =
    selectedFormat === 'jpg' ||
    selectedFormat === 'webp' ||
    selectedFormat === 'long-jpg' ||
    (selectedFormat === 'pdf' && doc.mimeType !== 'application/pdf');

  const handleConfirmDownload = async () => {
    setExporting(true);
    setError('');
    try {
      const result = await exportDocumentInFormat(doc, selectedFormat, quality);
      const countNote =
        result.exportedFiles.length > 1
          ? `${result.exportedFiles.length} files (${activeOption.badge})`
          : result.exportedFiles[0];
      onDownloaded?.(`Downloaded ${countNote} · ${formatBytes(result.totalBytes)}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed. Please try another format.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose Download Format"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            {doc.mimeType === 'application/pdf' ? (
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-emerald-700" />
              </div>
            ) : (
              <img
                src={doc.thumbnailUrl || doc.dataUrl}
                alt={doc.title}
                className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-display font-bold text-slate-900 truncate">
                Select Download Format
              </h2>
              <p className="text-xs text-slate-500 truncate">{doc.title}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Close download format dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selectable Format List */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          <div className="space-y-2" role="radiogroup" aria-label="Download formats">
            {formats.map((opt) => {
              const selected = selectedFormat === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSelectedFormat(opt.id)}
                  className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors min-h-[56px] ${
                    selected
                      ? 'border-emerald-700 bg-emerald-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-11 h-8 rounded-lg font-mono text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        selected
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {opt.badge}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {opt.label}
                        </span>
                        {opt.recommended && (
                          <span className="text-[11px] font-medium text-emerald-700">
                            · Original
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{opt.description}</p>
                    </div>
                  </div>

                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      selected
                        ? 'bg-emerald-700 border-emerald-700 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3" />}
                  </span>
                </button>
              );
            })}
          </div>

          {showQuality && (
            <div className="pt-1">
              <div className="text-xs font-medium text-slate-600 mb-1.5">Export Quality</div>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                {QUALITY_OPTIONS.map((q) => {
                  const active = Math.abs(quality - q.value) < 0.01;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setQuality(q.value)}
                      className={`py-2 px-2 rounded-lg text-center transition-colors ${
                        active
                          ? 'bg-white text-emerald-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <div className="text-xs font-semibold">{q.label}</div>
                      <div className="text-[10px] text-slate-500">{q.note}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500">Output file</div>
            <div className="text-xs font-mono text-slate-800 truncate">{previewFileName}</div>
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={handleConfirmDownload}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 transition-colors disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{exporting ? 'Preparing...' : `Download ${activeOption.badge}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
