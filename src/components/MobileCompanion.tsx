import {
  ArrowUpDown,
  BookOpen,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  CloudUpload,
  CreditCard,
  Crop,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Languages,
  Laptop,
  Layers,
  LayoutGrid,
  List,
  Monitor,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
  User,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { formatBytes } from '../services/db';
import { formatCompactDocTimestamp, getCategoryChipLabel } from '../services/docViewMath';
import { imagesToPdf } from '../services/pdfService';
import type {
  DocumentCategory,
  MobileView,
  OcrLanguage,
  ScanDocument,
  ScannerSettings,
  TransferJob,
  UserAccount,
} from '../types';
import { BrandLogo } from './BrandLogo';
import type { EditorStudioTab } from './ImageEditorModal';
import { MobileConnectPanel } from './PairingAndQrPanel';
import { PdfToolboxView } from './PdfToolboxView';
import { ScannerCameraStudio, type CaptureMode } from './ScannerCameraStudio';

interface MobileCompanionProps {
  documents: ScanDocument[];
  transfers: TransferJob[];
  pairCode: string;
  wsConnected: boolean;
  desktopOnline: boolean;
  isOffline: boolean;
  deviceName: string;
  settings: ScannerSettings;
  user: UserAccount | null;
  onDeviceNameChange: (name: string) => void;
  onPairWithCode: (code: string) => Promise<boolean>;
  onDisconnectPc: () => void;
  onSwitchToDesktop: () => void;
  onOpenAuth: () => void;
  onOpenLoginPanel: () => void;
  onSaveDocument: (params: {
    dataUrl: string;
    title: string;
    category: DocumentCategory;
    mimeType: string;
    fileExtension: string;
    pageCount?: number;
    pages?: string[];
  }) => Promise<void>;
  onDeleteDocument?: (id: string) => Promise<void>;
  onOpenDocPages: (doc: ScanDocument) => void;
  onPreviewDoc: (doc: ScanDocument) => void;
  onEditDoc: (doc: ScanDocument, tab?: EditorStudioTab) => void;
  onOpenOcr: (doc: ScanDocument) => void;
  onShareDoc: (doc: ScanDocument) => void;
  onDownloadDoc: (doc: ScanDocument) => void;
  onUpdateSettings: (next: ScannerSettings) => Promise<void>;
  onRetryTransfer: (job: TransferJob) => Promise<void>;
  driveConnected: boolean;
  onOpenDriveBackup: () => void;
}

export function MobileCompanion({
  documents,
  transfers,
  pairCode,
  wsConnected,
  desktopOnline,
  isOffline,
  deviceName,
  settings,
  user,
  onDeviceNameChange,
  onPairWithCode,
  onDisconnectPc,
  onSwitchToDesktop,
  onOpenAuth,
  onSaveDocument,
  onDeleteDocument,
  onOpenDocPages,
  onEditDoc,
  onOpenOcr,
  onShareDoc,
  onDownloadDoc,
  onUpdateSettings,
  onRetryTransfer,
  driveConnected,
  onOpenDriveBackup,
}: MobileCompanionProps) {
  const [view, setView] = useState<MobileView>('dashboard');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('document');
  const [docSearch, setDocSearch] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string>('ALL');
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [docLayout, setDocLayout] = useState<'grid' | 'list'>('grid');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [customLocalFolders, setCustomLocalFolders] = useState<string[]>([]);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const openCameraInMode = (mode: CaptureMode) => {
    setCaptureMode(mode);
    setView('quick-capture');
  };

  const handleGalleryImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
        await onSaveDocument({
          dataUrl,
          title: f.name.replace(/\.[^.]+$/, ''),
          category: isPdf ? 'PDFs' : 'Imported',
          mimeType: isPdf ? 'application/pdf' : f.type || 'image/jpeg',
          fileExtension: isPdf ? 'pdf' : f.name.split('.').pop() || 'jpg',
          pageCount: 1,
        });
      };
      reader.readAsDataURL(f);
    }
    e.target.value = '';
  };

  const pendingTransfers = transfers.filter(
    (t) => t.status === 'queued' || t.status === 'transferring'
  ).length;

  const folderSummaries = useMemo(() => {
    const baseFolders: Array<{ id: string; label: string }> = [
      { id: 'Scans', label: 'New Docs' },
      { id: 'ID_Cards', label: 'ID Cards' },
      { id: 'Receipts', label: 'Receipts' },
      { id: 'PDFs', label: 'PDF Files' },
      ...customLocalFolders.map((f) => ({ id: f, label: f })),
    ];
    return baseFolders.map((f) => ({
      ...f,
      count: documents.filter((d) => d.category === f.id || d.folder.endsWith(f.id)).length,
    }));
  }, [documents, customLocalFolders]);

  const activeFolderLabel =
    activeFolder === 'ALL'
      ? 'All docs'
      : folderSummaries.find((f) => f.id === activeFolder)?.label || activeFolder;

  const filteredDocuments = useMemo(() => {
    let list = documents;
    if (activeFolder !== 'ALL') {
      list = list.filter((d) => d.category === activeFolder || d.folder.endsWith(activeFolder));
    }
    const q = docSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q) ||
          d.ocrText.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [documents, activeFolder, docSearch, sortBy]);

  const toggleSelectDoc = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleBulkCombinePdf = async () => {
    const chosenImgs = documents.filter(
      (d) => selectedIds.includes(d.id) && d.mimeType.startsWith('image/')
    );
    if (chosenImgs.length === 0) return;
    const pdf = await imagesToPdf(chosenImgs.map((c) => c.dataUrl));
    await onSaveDocument({
      dataUrl: pdf.dataUrl,
      title: `Combined_${chosenImgs.length}_Pages`,
      category: 'PDFs',
      mimeType: 'application/pdf',
      fileExtension: 'pdf',
      pageCount: pdf.pageCount,
      pages: chosenImgs.map((c) => c.dataUrl),
    });
    setSelectedIds([]);
    setSelectMode(false);
  };

  const handleBulkDelete = async () => {
    if (!onDeleteDocument) return;
    for (const id of selectedIds) {
      await onDeleteDocument(id);
    }
    setSelectedIds([]);
    setSelectMode(false);
  };

  const scanShortcuts = [
    { id: 'doc', label: 'Scan Docs', desc: 'Auto paper-edge crop', icon: FilePlus2, action: () => openCameraInMode('document') },
    { id: 'auto', label: 'Auto Capture', desc: 'Hands-free paper lock', icon: ScanLine, action: () => openCameraInMode('auto') },
    { id: 'idcard', label: 'ID Card', desc: '1:1 A4 & Passport', icon: CreditCard, action: () => openCameraInMode('id-card') },
    { id: 'book', label: 'Book', desc: 'Split 2-page spread', icon: BookOpen, action: () => openCameraInMode('book') },
    { id: 'qr', label: 'QR Code', desc: 'Scan QR & barcodes', icon: QrCode, action: () => openCameraInMode('qr-code') },
    { id: 'totext', label: 'To Text', desc: 'Instant EN & HI OCR', icon: Languages, action: () => openCameraInMode('to-text') },
    { id: 'quick', label: 'Quick Scan', desc: '1-tap rapid capture', icon: Zap, action: () => openCameraInMode('quick') },
    { id: 'batch', label: 'Batch Mode', desc: 'Multi-page to PDF', icon: Layers, action: () => openCameraInMode('batch') },
  ];

  const processShortcuts = [
    { id: 'import', label: 'Import Files', desc: 'Photos & PDFs', icon: Upload, action: () => galleryInputRef.current?.click() },
    {
      id: 'crop-resize',
      label: 'Crop & Resize KB',
      desc: '4-corner & exact KB',
      icon: Crop,
      action: () => {
        const latestImg = documents.find((d) => d.mimeType.startsWith('image/'));
        if (latestImg) onEditDoc(latestImg, 'crop');
        else galleryInputRef.current?.click();
      },
    },
    {
      id: 'compression',
      label: 'Compression',
      desc: 'Target KB / MB size',
      icon: SlidersHorizontal,
      action: () => {
        const latestImg = documents.find((d) => d.mimeType.startsWith('image/'));
        if (latestImg) onEditDoc(latestImg, 'resize');
        else galleryInputRef.current?.click();
      },
    },
    { id: 'collage', label: 'Collage Images', desc: 'Combine into sheet', icon: ImageIcon, action: () => setView('pdf-tools') },
    { id: 'pdf-merge', label: 'PDF Merge', desc: 'Join multiple PDFs', icon: FileText, action: () => setView('pdf-tools') },
    {
      id: 'pc-sync',
      label: 'PC Sync',
      desc: pairCode && wsConnected ? `Paired ${pairCode}` : 'Pair Windows PC',
      icon: Laptop,
      action: () => setView('connect-pc'),
    },
    {
      id: 'transfers',
      label: 'Transfer Queue',
      desc: pendingTransfers > 0 ? `${pendingTransfers} pending` : `${transfers.length} transfers`,
      icon: RefreshCw,
      action: () => setView('transfers'),
    },
    {
      id: 'drive',
      label: 'Google Drive',
      desc: driveConnected ? 'Backup connected' : 'Cloud sync & backup',
      icon: HardDrive,
      action: onOpenDriveBackup,
    },
  ];

  const isDocsActive = view === 'dashboard' || view === 'documents';

  if (view === 'quick-capture') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <ScannerCameraStudio
          mode={captureMode}
          settings={settings}
          onModeChange={setCaptureMode}
          onQuickCaptureSave={onSaveDocument}
          onClose={() => setView('dashboard')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col pb-16">
      {/* Clean White Top Header matching Screenshot 1 */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md px-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setView('me')}
          className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 hover:border-emerald-600 transition-colors"
          aria-label={user ? `Profile ${user.displayName}` : 'Profile and settings'}
        >
          {user ? (
            <span className="text-xs font-bold text-emerald-900">
              {user.displayName.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <User className="w-5 h-5 text-amber-800" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setView('dashboard')}
          className="flex items-center gap-2 min-w-0"
        >
          <BrandLogo size={24} />
          <span className="text-base sm:text-lg font-display font-extrabold tracking-tight text-[#0d8a4b] truncate">
            Oklivo Scanner
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!isDocsActive) setView('dashboard');
              setShowSearchBar((s) => !s);
            }}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-800"
            aria-label="Search documents"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onSwitchToDesktop}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop
          </button>
        </div>
      </header>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleGalleryImport}
        className="hidden"
      />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto">
        {/* DOCS HOME VIEW (Screenshot 1) */}
        {(view === 'dashboard' || view === 'documents') && (
          <div className="px-3.5 sm:px-6 pt-2 pb-4 space-y-3">
            {/* Optional Toggleable Search Input */}
            {showSearchBar && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Search docs, OCR Hindi/English text, or category..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  autoFocus
                />
              </div>
            )}

            {/* Sub-header Toolbar: All docs ▾  +  Sort · View · Select (Screenshot 1) */}
            <div className="relative flex items-center justify-between gap-2 py-1">
              <button
                type="button"
                onClick={() => setShowFolderMenu((v) => !v)}
                className="inline-flex items-center gap-1 text-xl font-display font-bold text-slate-900 tracking-tight"
                aria-expanded={showFolderMenu}
              >
                <span>{activeFolderLabel}</span>
                <ChevronDown className="w-4 h-4 text-[#0d8a4b]" />
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setSortBy((s) => (s === 'date' ? 'name' : s === 'name' ? 'size' : 'date'))
                  }
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                  aria-label={`Sort documents (${sortBy})`}
                  title={`Sort: ${sortBy}`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDocLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                  aria-label="Toggle grid or list view"
                  title={docLayout === 'grid' ? 'Switch to List view' : 'Switch to Grid view'}
                >
                  {docLayout === 'grid' ? (
                    <List className="w-4 h-4" />
                  ) : (
                    <LayoutGrid className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedIds([]);
                  }}
                  className={`min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg transition-colors ${
                    selectMode
                      ? 'bg-emerald-50 text-[#0d8a4b]'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  aria-label="Select documents"
                  title="Select documents"
                >
                  <CheckSquare className="w-4 h-4" />
                </button>
              </div>

              {/* Folder Dropdown Popover */}
              {showFolderMenu && (
                <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-30 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFolder('ALL');
                      setShowFolderMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium ${
                      activeFolder === 'ALL'
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>All docs</span>
                    <span className="tabular-nums text-slate-500">{documents.length}</span>
                  </button>
                  {folderSummaries.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setActiveFolder(f.id);
                        setShowFolderMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium ${
                        activeFolder === f.id
                          ? 'bg-emerald-50 text-emerald-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Folder className="w-3.5 h-3.5 text-amber-500" />
                        {f.label}
                      </span>
                      <span className="tabular-nums text-slate-500">{f.count}</span>
                    </button>
                  ))}
                  <div className="pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setShowFolderMenu(false);
                        setShowNewFolderInput(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      New Folder
                    </button>
                  </div>
                </div>
              )}
            </div>

            {showNewFolderInput && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = newFolderName.trim();
                  if (clean && !customLocalFolders.includes(clean)) {
                    setCustomLocalFolders((prev) => [...prev, clean]);
                  }
                  setNewFolderName('');
                  setShowNewFolderInput(false);
                }}
                className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2"
              >
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name (e.g. Tax Invoices)"
                  className="flex-1 text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold bg-[#0d8a4b] text-white rounded-lg"
                >
                  Create
                </button>
              </form>
            )}

            {/* Multi-select Batch Action Bar */}
            {(selectMode || selectedIds.length > 0) && (
              <div className="bg-emerald-950 text-white rounded-xl px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium tabular-nums">
                  {selectedIds.length} selected
                </span>
                <div className="flex items-center gap-1.5">
                  {selectedIds.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleBulkCombinePdf}
                        className="px-2.5 py-1 rounded-lg bg-[#0d8a4b] hover:bg-emerald-500 font-semibold"
                      >
                        To PDF
                      </button>
                      {onDeleteDocument && (
                        <button
                          type="button"
                          onClick={handleBulkDelete}
                          className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 font-semibold"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedIds([]);
                    }}
                    className="px-2 py-1 text-emerald-200 hover:text-white"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Document Cards (3-col Mobile Grid matching Screenshot 1, or List view) */}
            {filteredDocuments.length === 0 ? (
              <div className="border border-slate-200 rounded-2xl py-16 px-4 text-center space-y-3">
                <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                <div className="text-sm font-medium text-slate-600">
                  No documents in this folder yet
                </div>
                <button
                  type="button"
                  onClick={() => openCameraInMode('document')}
                  className="px-4 py-2 text-xs font-semibold bg-[#0d8a4b] hover:bg-emerald-600 text-white rounded-xl"
                >
                  Scan new docs
                </button>
              </div>
            ) : docLayout === 'grid' ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
                {filteredDocuments.map((doc) => {
                  const selected = selectedIds.includes(doc.id);
                  const categoryLabel = getCategoryChipLabel(doc.category);
                  const timeLabel = formatCompactDocTimestamp(doc.createdAt);

                  return (
                    <div
                      key={doc.id}
                      className={`bg-white border rounded-md overflow-hidden flex flex-col transition-colors ${
                        selected
                          ? 'border-[#0d8a4b] ring-1 ring-[#0d8a4b]'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Thumbnail area with bottom-right sync icon (Screenshot 1) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (selectMode) {
                            toggleSelectDoc(doc.id);
                          } else {
                            onOpenDocPages(doc);
                          }
                        }}
                        className="relative aspect-[3/4] w-full bg-slate-50 border-b border-slate-100 flex items-center justify-center overflow-hidden"
                        aria-label={`Open ${doc.title}`}
                      >
                        {doc.mimeType === 'application/pdf' ? (
                          doc.thumbnailUrl ? (
                            <img
                              src={doc.thumbnailUrl}
                              alt={doc.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <FileText className="w-8 h-8 text-[#0d8a4b]" />
                              <span className="text-[9px] font-bold text-slate-500">PDF</span>
                            </div>
                          )
                        ) : (
                          <img
                            src={doc.dataUrl}
                            alt={doc.title}
                            className="w-full h-full object-cover"
                          />
                        )}

                        <span
                          className={`absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow-sm ${
                            doc.syncStatus === 'synced'
                              ? 'bg-[#0d8a4b] text-white'
                              : 'bg-amber-500 text-white'
                          }`}
                          title={doc.syncStatus === 'synced' ? 'Synced' : 'Local copy'}
                        >
                          <CloudUpload className="w-3 h-3" />
                        </span>
                      </button>

                      {/* Card Body: Title · Timestamp · [1] Category + Circle (Screenshot 1) */}
                      <div className="p-1.5 flex-1 flex flex-col justify-between gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectMode) toggleSelectDoc(doc.id);
                            else onOpenDocPages(doc);
                          }}
                          className="text-left min-w-0"
                        >
                          <div className="text-[11px] sm:text-xs font-medium text-slate-900 leading-snug line-clamp-2">
                            {doc.title}
                          </div>
                          {timeLabel && (
                            <div className="text-[9px] sm:text-[10px] text-slate-400 tabular-nums mt-0.5 truncate">
                              {timeLabel}
                            </div>
                          )}
                        </button>

                        <div className="flex items-center justify-between gap-1 pt-0.5">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-[3px] bg-slate-200 text-slate-600 text-[9px] font-bold tabular-nums shrink-0">
                              {doc.pageCount}
                            </span>
                            <span className="px-1 py-0.5 rounded-[3px] bg-emerald-50 text-[#0d8a4b] text-[9px] font-medium truncate">
                              {categoryLabel}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!selectMode) setSelectMode(true);
                              toggleSelectDoc(doc.id);
                            }}
                            aria-label={`Select ${doc.title}`}
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                              selected
                                ? 'bg-[#0d8a4b] border-[#0d8a4b] text-white'
                                : 'border-slate-300 hover:border-[#0d8a4b]'
                            }`}
                          >
                            {selected && <Check className="w-2.5 h-2.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                {filteredDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="px-3.5 py-3 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenDocPages(doc)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                    >
                      {doc.mimeType === 'application/pdf' ? (
                        <div className="w-11 h-12 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                      ) : (
                        <img
                          src={doc.dataUrl}
                          alt={doc.title}
                          className="w-11 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">{doc.title}</div>
                        <div className="text-xs text-slate-500 tabular-nums truncate mt-0.5">
                          {formatCompactDocTimestamp(doc.createdAt)} · {formatBytes(doc.sizeBytes)} ·{' '}
                          {doc.pageCount}p
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenOcr(doc)}
                        className="p-2 text-slate-600 hover:text-emerald-700"
                        aria-label={`OCR ${doc.title}`}
                      >
                        <Languages className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onShareDoc(doc)}
                        className="p-2 text-slate-600 hover:text-emerald-700"
                        aria-label={`Share ${doc.title}`}
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadDoc(doc)}
                        className="p-2 text-[#0d8a4b] hover:bg-emerald-50 rounded-lg"
                        aria-label={`Download ${doc.title}`}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TOOLS / SHORTCUTS VIEW */}
        {view === 'tools' && (
          <div className="p-4 sm:p-6 space-y-6">
            <div>
              <h1 className="text-lg font-display font-bold text-slate-900">Shortcuts</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Paper-aware scanning modes, PDF toolbox, and Mobile-to-PC transfer
              </p>
            </div>

            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-600">Scan</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {scanShortcuts.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.action}
                      className="bg-white border border-slate-200 hover:border-emerald-600 rounded-2xl p-4 text-left flex flex-col justify-between gap-3 min-h-[100px] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#0d8a4b] flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-600">Process Files & Sync</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {processShortcuts.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.action}
                      className="bg-white border border-slate-200 hover:border-emerald-600 rounded-2xl p-4 text-left flex flex-col justify-between gap-3 min-h-[100px] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {view === 'pdf-tools' && (
          <div className="p-4 sm:p-6">
            <PdfToolboxView documents={documents} onSaveGeneratedDocument={onSaveDocument} />
          </div>
        )}

        {view === 'connect-pc' && (
          <div className="p-4 sm:p-6">
            <MobileConnectPanel
              currentPairCode={pairCode}
              wsConnected={wsConnected}
              desktopOnline={desktopOnline}
              deviceName={deviceName}
              onDeviceNameChange={onDeviceNameChange}
              onPairWithCode={onPairWithCode}
              onDisconnect={onDisconnectPc}
            />
          </div>
        )}

        {view === 'transfers' && (
          <div className="p-4 sm:p-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <h2 className="text-base font-bold text-slate-900">Mobile Transfer Queue</h2>
              {transfers.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No transfer jobs queued yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {transfers.map((job) => (
                    <div key={job.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{job.title}</div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {formatBytes(job.sizeBytes)} · {job.status} ({job.progress}%)
                        </div>
                      </div>
                      {(job.status === 'failed' || job.status === 'queued') && (
                        <button
                          type="button"
                          onClick={() => onRetryTransfer(job)}
                          className="px-3 py-2 text-xs font-semibold bg-emerald-800 text-white rounded-xl min-h-[40px]"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ME & SETTINGS VIEW (Opened from Top-Left Avatar) */}
        {(view === 'me' || view === 'settings') && (
          <div className="p-4 sm:p-6 space-y-4 max-w-xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-[#0d8a4b]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {user ? user.displayName : 'Sign in / Register'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {isOffline ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <WifiOff className="w-3.5 h-3.5" /> Offline Mode
                      </span>
                    ) : user ? (
                      user.email || user.phone
                    ) : (
                      'Local storage active · Tap to sync cloud'
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-3.5 py-2 rounded-xl bg-[#0d8a4b] hover:bg-emerald-600 text-white text-xs font-semibold shrink-0"
              >
                {user ? 'Manage' : 'Sign In'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setView('connect-pc')}
                className="bg-emerald-950 text-white rounded-xl p-3.5 text-left flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-emerald-300">Connected PC</div>
                  <div className="text-xs font-semibold truncate mt-0.5">
                    {pairCode && wsConnected ? `Paired ${pairCode}` : 'Pair Windows PC'}
                  </div>
                </div>
                <Laptop className="w-5 h-5 text-emerald-300 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setView('transfers')}
                className="bg-white border border-slate-200 rounded-xl p-3.5 text-left flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500">Transfer Queue</div>
                  <div className="text-xs font-semibold text-slate-900 truncate mt-0.5 tabular-nums">
                    {pendingTransfers > 0 ? `${pendingTransfers} pending` : `${transfers.length} jobs`}
                  </div>
                </div>
                <RefreshCw className="w-4 h-4 text-[#0d8a4b] shrink-0" />
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Scan & Transfer Settings</h2>

              <label className="flex items-center justify-between text-sm py-1">
                <span>Auto-Crop Paper Boundaries</span>
                <input
                  type="checkbox"
                  checked={settings.autoCrop}
                  onChange={(e) => onUpdateSettings({ ...settings, autoCrop: e.target.checked })}
                  className="accent-emerald-700 w-5 h-5"
                />
              </label>
              <label className="flex items-center justify-between text-sm py-1">
                <span>Auto-Transfer After Capture</span>
                <input
                  type="checkbox"
                  checked={settings.autoTransfer}
                  onChange={(e) => onUpdateSettings({ ...settings, autoTransfer: e.target.checked })}
                  className="accent-emerald-700 w-5 h-5"
                />
              </label>
              <label className="flex items-center justify-between text-sm py-1">
                <span>Auto-Enhance Scans</span>
                <input
                  type="checkbox"
                  checked={settings.autoEnhance}
                  onChange={(e) => onUpdateSettings({ ...settings, autoEnhance: e.target.checked })}
                  className="accent-emerald-700 w-5 h-5"
                />
              </label>
              <label className="flex items-center justify-between text-sm py-1">
                <span>Auto-OCR After Image Capture</span>
                <input
                  type="checkbox"
                  checked={settings.autoOcrOnCapture}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, autoOcrOnCapture: e.target.checked })
                  }
                  className="accent-emerald-700 w-5 h-5"
                />
              </label>
              <label className="flex items-center justify-between text-sm py-1">
                <span>Simulate Offline Mode</span>
                <input
                  type="checkbox"
                  checked={settings.offlineModeSimulated}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, offlineModeSimulated: e.target.checked })
                  }
                  className="accent-emerald-700 w-5 h-5"
                />
              </label>

              <label className="flex items-center justify-between text-sm py-1 gap-3">
                <span>OCR Language</span>
                <select
                  value={settings.ocrDefaultLang}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, ocrDefaultLang: e.target.value as OcrLanguage })
                  }
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="eng+hin">English + Hindi</option>
                  <option value="eng">English Only</option>
                  <option value="hin">Hindi Only</option>
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                JPEG Quality ({Math.round(settings.jpegQuality * 100)}%)
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={Math.round(settings.jpegQuality * 100)}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, jpegQuality: Number(e.target.value) / 100 })
                  }
                  className="w-full mt-1 accent-emerald-700"
                />
              </label>

              <button
                type="button"
                onClick={onOpenDriveBackup}
                className="w-full py-3 bg-[#0d8a4b] hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl min-h-[44px] inline-flex items-center justify-center gap-2"
              >
                <HardDrive className="w-4 h-4" />
                {driveConnected ? 'Google Drive Connected (Manage)' : 'Save All Data to Google Drive'}
              </button>

              <button
                type="button"
                onClick={onSwitchToDesktop}
                className="w-full py-3 bg-slate-900 text-white text-xs font-semibold rounded-xl min-h-[44px] inline-flex items-center justify-center gap-2"
              >
                <Monitor className="w-4 h-4" />
                Switch to Desktop Workbench
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Clean 3-Slot Bottom Navigation Bar: Docs · [Camera FAB] · Tools (Screenshot 1) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 items-center"
        aria-label="Mobile Tab Navigation"
      >
        <button
          type="button"
          onClick={() => setView('dashboard')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            isDocsActive ? 'text-[#0d8a4b]' : 'text-slate-500'
          }`}
        >
          <FileText className="w-5 h-5" />
          <span className="text-[11px] font-semibold mt-0.5">Docs</span>
        </button>

        <div className="flex items-center justify-center h-full">
          <button
            type="button"
            onClick={() => openCameraInMode('document')}
            aria-label="Open Scanner Camera"
            className="w-14 h-14 -mt-5 rounded-full bg-[#0d8a4b] hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg border-4 border-white active:scale-95 transition-transform"
          >
            <Camera className="w-6 h-6" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setView('tools')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            view === 'tools' || view === 'pdf-tools' ? 'text-[#0d8a4b]' : 'text-slate-500'
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[11px] font-semibold mt-0.5">Tools</span>
        </button>
      </nav>
    </div>
  );
}
