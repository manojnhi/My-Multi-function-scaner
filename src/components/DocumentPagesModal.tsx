import {
  ArrowLeft,
  Camera,
  Check,
  CheckSquare,
  Download,
  FileText,
  Image as ImageIcon,
  Languages,
  LayoutGrid,
  Maximize2,
  MoreVertical,
  Pencil,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatPageBadgeNumber, toggleIndexSelection } from '../services/docViewMath';
import { composeLongImage, getDataUrlByteLength } from '../services/imageProcessor';
import { imagesToPdf, pdfToImages } from '../services/pdfService';
import type { DocumentFilterMode, ScanDocument } from '../types';
import type { EditorStudioTab } from './ImageEditorModal';
import { ScanPageStudioModal } from './ScanPageStudioModal';

interface DocumentPagesModalProps {
  document: ScanDocument;
  onClose: () => void;
  onUpdateDocument: (updated: ScanDocument) => Promise<void>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onShareDoc: (doc: ScanDocument) => void;
  onDownloadDoc: (doc: ScanDocument) => void;
  onOpenOcr: (doc: ScanDocument) => void;
  onOpenPreview: (doc: ScanDocument) => void;
  onOpenImageEditor: (doc: ScanDocument, tab?: EditorStudioTab) => void;
  onOpenPdfTools?: () => void;
  onLaunchCameraForDoc?: () => void;
  onSaveNewCollage?: (params: {
    dataUrl: string;
    title: string;
    mimeType: string;
    fileExtension: string;
    pageCount?: number;
  }) => Promise<void>;
}

export function DocumentPagesModal({
  document: doc,
  onClose,
  onUpdateDocument,
  onDeleteDocument,
  onShareDoc,
  onDownloadDoc,
  onOpenOcr,
  onOpenPreview,
  onOpenImageEditor,
  onOpenPdfTools,
  onLaunchCameraForDoc,
  onSaveNewCollage,
}: DocumentPagesModalProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(doc.title);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [studioPageIndex, setStudioPageIndex] = useState<number | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitleDraft(doc.title);
  }, [doc.title]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        if (doc.pages && doc.pages.length > 0) {
          if (active) setPages(doc.pages);
        } else if (doc.mimeType === 'application/pdf') {
          const imgs = await pdfToImages(doc.dataUrl, 1.4, 0.86);
          if (active) setPages(imgs.length > 0 ? imgs : []);
        } else {
          if (active) setPages([doc.dataUrl]);
        }
      } catch {
        if (active) setPages(doc.mimeType.startsWith('image/') ? [doc.dataUrl] : []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [doc.dataUrl, doc.mimeType, doc.pages]);

  const handleSaveRename = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = titleDraft.trim();
    setEditingTitle(false);
    if (!clean || clean === doc.title) {
      setTitleDraft(doc.title);
      return;
    }
    await onUpdateDocument({ ...doc, title: clean });
  };

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setShowAddSheet(false);

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file);
          })
      )
    ).then(async (loaded) => {
      const valid = loaded.filter(Boolean);
      if (valid.length === 0) return;
      const merged = [...pages, ...valid];
      setPages(merged);
      await persistPagesToDoc(merged, doc.title, doc.filterMode);
    });

    e.target.value = '';
  };

  const persistPagesToDoc = async (
    nextPages: string[],
    nextTitle: string,
    nextFilterMode: DocumentFilterMode
  ) => {
    if (nextPages.length === 0) return;
    if (doc.mimeType === 'application/pdf' || nextPages.length > 1) {
      if (doc.mimeType === 'application/pdf') {
        const pdf = await imagesToPdf(nextPages);
        await onUpdateDocument({
          ...doc,
          title: nextTitle,
          dataUrl: pdf.dataUrl,
          thumbnailUrl: nextPages[0],
          pages: nextPages,
          pageCount: pdf.pageCount,
          sizeBytes: pdf.sizeBytes,
          filterMode: nextFilterMode,
        });
        return;
      }
    }
    const totalBytes = nextPages.reduce((sum, u) => sum + getDataUrlByteLength(u), 0);
    await onUpdateDocument({
      ...doc,
      title: nextTitle,
      dataUrl: nextPages[0],
      thumbnailUrl: nextPages[0],
      pages: nextPages,
      pageCount: nextPages.length,
      sizeBytes: totalBytes,
      filterMode: nextFilterMode,
    });
  };

  const handleDeleteSelectedPages = async () => {
    if (selectedIndices.length === 0) return;
    if (selectedIndices.length >= pages.length) {
      await onDeleteDocument(doc.id);
      onClose();
      return;
    }
    const remaining = pages.filter((_, idx) => !selectedIndices.includes(idx));
    setPages(remaining);
    setSelectedIndices([]);
    setSelectMode(false);
    await persistPagesToDoc(remaining, doc.title, doc.filterMode);
  };

  const handleCreateCollage = async () => {
    if (pages.length === 0) {
      onOpenPdfTools?.();
      return;
    }
    setBusyAction('Creating collage...');
    try {
      const targetPages =
        selectedIndices.length > 0 ? selectedIndices.map((i) => pages[i]).filter(Boolean) : pages;
      if (targetPages.length === 1 && onOpenPdfTools) {
        onClose();
        onOpenPdfTools();
        return;
      }
      const collage = await composeLongImage(targetPages, 0.9);
      if (onSaveNewCollage) {
        await onSaveNewCollage({
          dataUrl: collage.dataUrl,
          title: `${doc.title} Collage`,
          mimeType: 'image/jpeg',
          fileExtension: 'jpg',
          pageCount: 1,
        });
      }
      setBusyAction('');
      onClose();
    } catch {
      setBusyAction('');
      if (onOpenPdfTools) {
        onClose();
        onOpenPdfTools();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-white text-slate-900 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`Document pages: ${doc.title}`}
    >
      <input
        ref={addFileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleAddFiles}
        className="hidden"
      />

      {/* Clean White Header (Screenshot 2) */}
      <header className="h-14 shrink-0 px-3 sm:px-5 bg-white border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Back to docs"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {editingTitle ? (
            <form onSubmit={handleSaveRename} className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-semibold border border-emerald-600 rounded-lg focus:outline-none"
                aria-label="Document title"
                autoFocus
              />
              <button
                type="submit"
                className="p-2 rounded-lg bg-emerald-700 text-white shrink-0"
                aria-label="Save title"
              >
                <Check className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-base sm:text-lg font-display font-medium text-slate-900 truncate">
                {doc.title}
              </h1>
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 shrink-0"
                aria-label="Rename document"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectMode((v) => !v);
            setSelectedIndices([]);
          }}
          className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors shrink-0 ${
            selectMode ? 'bg-emerald-50 text-emerald-700' : 'text-slate-800 hover:bg-slate-100'
          }`}
          aria-label="Select pages"
          title="Select pages"
        >
          <CheckSquare className="w-5 h-5" />
        </button>
      </header>

      {/* Multi-select Batch Bar */}
      {selectMode && (
        <div className="px-4 py-2 bg-emerald-950 text-white text-xs flex items-center justify-between gap-2 shrink-0">
          <span className="tabular-nums font-medium">
            {selectedIndices.length} page{selectedIndices.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            {selectedIndices.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteSelectedPages}
                className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 font-semibold"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectMode(false);
                setSelectedIndices([]);
              }}
              className="px-2 py-1 text-emerald-200 hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main 2-Column+ Page Grid Canvas (Screenshot 2) */}
      <main className="flex-1 overflow-y-auto bg-white p-3.5 sm:p-6">
        <div className="max-w-5xl mx-auto">
          {loading ? (
            <div className="py-20 text-center text-xs text-slate-500">Loading document pages...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
              {pages.map((src, idx) => {
                const isSelected = selectedIndices.includes(idx);
                return (
                  <button
                    key={`${doc.id}_page_${idx}`}
                    type="button"
                    onClick={() => {
                      if (selectMode) {
                        setSelectedIndices((prev) => toggleIndexSelection(prev, idx));
                      } else {
                        setStudioPageIndex(idx);
                      }
                    }}
                    className={`relative aspect-[3/4] bg-[#f3f4f6] border overflow-hidden flex flex-col justify-between text-left transition-all ${
                      isSelected
                        ? 'border-2 border-emerald-600 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 hover:border-emerald-600'
                    }`}
                    aria-label={`Open page ${formatPageBadgeNumber(idx)}`}
                  >
                    <div className="flex-1 w-full overflow-hidden flex items-center justify-center bg-white">
                      {src ? (
                        <img
                          src={src}
                          alt={`${doc.title} page ${idx + 1}`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <ImageIcon className="w-10 h-10 text-slate-300" />
                      )}
                    </div>

                    {selectMode && (
                      <span
                        className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSelected
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white/90 border-slate-400'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                      </span>
                    )}

                    {/* Dark Bottom Page Number Strip: 01, 02 ... (Screenshot 2) */}
                    <div className="w-full bg-[#7c7c7c]/85 text-white text-xs font-medium px-2.5 py-1 tabular-nums">
                      {formatPageBadgeNumber(idx)}
                    </div>
                  </button>
                );
              })}

              {/* Dashed "Tap to add new pages" Tile (Screenshot 2) */}
              <button
                type="button"
                onClick={() => setShowAddSheet(true)}
                className="aspect-[3/4] border border-dashed border-slate-400 hover:border-emerald-600 hover:bg-emerald-50/40 flex flex-col items-center justify-center p-3 text-center text-slate-400 hover:text-emerald-700 transition-colors gap-1.5"
              >
                <div className="flex flex-wrap items-center justify-center gap-1 text-xs leading-snug">
                  <span>Tap</span>
                  <Camera className="w-4 h-4 inline-block text-slate-400" />
                  <span>to add new pages</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Bottom 5-Button White Action Bar: Add · Collage · Share · Edit PDF · More (Screenshot 2) */}
      <footer className="h-16 shrink-0 bg-white border-t border-slate-200 grid grid-cols-5 items-center max-w-full">
        <button
          type="button"
          onClick={() => setShowAddSheet(true)}
          className="flex flex-col items-center justify-center h-full text-slate-800 hover:text-emerald-700 transition-colors"
        >
          <Camera className="w-5 h-5" />
          <span className="text-[11px] font-medium mt-0.5">Add</span>
        </button>

        <button
          type="button"
          onClick={handleCreateCollage}
          disabled={Boolean(busyAction)}
          className="flex flex-col items-center justify-center h-full text-slate-800 hover:text-emerald-700 transition-colors"
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[11px] font-medium mt-0.5">
            {busyAction ? 'Working...' : 'Collage'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onShareDoc(doc)}
          className="flex flex-col items-center justify-center h-full text-slate-800 hover:text-emerald-700 transition-colors"
        >
          <Share2 className="w-5 h-5" />
          <span className="text-[11px] font-medium mt-0.5">Share</span>
        </button>

        <button
          type="button"
          onClick={() => onDownloadDoc(doc)}
          className="flex flex-col items-center justify-center h-full text-slate-800 hover:text-emerald-700 transition-colors"
        >
          <FileText className="w-5 h-5" />
          <span className="text-[11px] font-medium mt-0.5">Edit PDF</span>
        </button>

        <button
          type="button"
          onClick={() => setShowMoreMenu(true)}
          className="flex flex-col items-center justify-center h-full text-slate-800 hover:text-emerald-700 transition-colors"
          aria-label="More document options"
        >
          <MoreVertical className="w-5 h-5" />
          <span className="text-[11px] font-medium mt-0.5">More</span>
        </button>
      </footer>

      {/* Add Page Choice Sheet */}
      {showAddSheet && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowAddSheet(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold text-slate-900">Add New Pages</div>
            <div className="grid grid-cols-2 gap-2.5">
              {onLaunchCameraForDoc && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddSheet(false);
                    onClose();
                    onLaunchCameraForDoc();
                  }}
                  className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-slate-200 hover:border-emerald-600 text-xs font-semibold text-slate-800"
                >
                  <Camera className="w-5 h-5 text-emerald-700" />
                  Scan with Camera
                </button>
              )}
              <button
                type="button"
                onClick={() => addFileInputRef.current?.click()}
                className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-slate-200 hover:border-emerald-600 text-xs font-semibold text-slate-800 ${
                  onLaunchCameraForDoc ? '' : 'col-span-2'
                }`}
              >
                <Upload className="w-5 h-5 text-emerald-700" />
                Import from Files
              </button>
            </div>
          </div>
        </div>
      )}

      {/* More Options Sheet */}
      {showMoreMenu && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowMoreMenu(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
              Document Actions
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(false);
                onDownloadDoc(doc);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-sm text-slate-800"
            >
              <Download className="w-4 h-4 text-emerald-700" />
              Download Format (PDF, JPG, PNG, WebP)
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(false);
                onOpenPreview(doc);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-sm text-slate-800"
            >
              <Maximize2 className="w-4 h-4 text-emerald-700" />
              Full-Size Viewer & Print
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(false);
                onOpenOcr(doc);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-sm text-slate-800"
            >
              <Languages className="w-4 h-4 text-emerald-700" />
              Extract OCR Text (EN + HI)
            </button>
            {doc.mimeType.startsWith('image/') && (
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenImageEditor(doc, 'resize');
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-sm text-slate-800"
              >
                <SlidersHorizontal className="w-4 h-4 text-emerald-700" />
                Resize Exact KB & Dimensions
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                setShowMoreMenu(false);
                await onDeleteDocument(doc.id);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 text-sm text-red-600"
            >
              <Trash2 className="w-4 h-4" />
              Delete Document
            </button>
          </div>
        </div>
      )}

      {/* Dark Single/Multi-Page Filter & Crop Studio (Screenshot 3) */}
      {studioPageIndex !== null && (
        <ScanPageStudioModal
          document={{ ...doc, pages }}
          initialPageIndex={studioPageIndex}
          onClose={() => setStudioPageIndex(null)}
          onSaveDocumentPages={async ({ title: nextTitle, pages: nextPages, filterMode }) => {
            setPages(nextPages);
            await persistPagesToDoc(nextPages, nextTitle, filterMode);
          }}
          onDeleteDocument={async (id) => {
            await onDeleteDocument(id);
            setStudioPageIndex(null);
            onClose();
          }}
          onRequestRetakeCamera={
            onLaunchCameraForDoc
              ? () => {
                  setStudioPageIndex(null);
                  onClose();
                  onLaunchCameraForDoc();
                }
              : undefined
          }
          onRequestAddCamera={
            onLaunchCameraForDoc
              ? () => {
                  setStudioPageIndex(null);
                  onClose();
                  onLaunchCameraForDoc();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
