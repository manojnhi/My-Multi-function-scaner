import {
  ArrowUpDown,
  Bell,
  Cloud,
  CloudUpload,
  Crop,
  Download,
  Eye,
  FileCode2,
  FileText,
  Folder,
  FolderPlus,
  Grid,
  HardDrive,
  Image as ImageIcon,
  Languages,
  Laptop,
  Layers,
  LayoutDashboard,
  List,
  LogIn,
  MonitorSmartphone,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
  User,
  WifiOff,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { DEFAULT_FOLDERS, formatBytes } from '../services/db';
import { imagesToPdf } from '../services/pdfService';
import type {
  ActivityNotification,
  DesktopView,
  DocumentCategory,
  PairedDevice,
  ScanDocument,
  ScannerSettings,
  TransferJob,
  UserAccount,
} from '../types';
import { BrandLogo } from './BrandLogo';
import type { EditorStudioTab } from './ImageEditorModal';
import { NativeBuildsView } from './NativeBuildsView';
import { DesktopPairingPanel } from './PairingAndQrPanel';
import { PdfToolboxView } from './PdfToolboxView';
import { ScannerCameraStudio, type CaptureMode } from './ScannerCameraStudio';

interface DesktopWorkbenchProps {
  documents: ScanDocument[];
  transfers: TransferJob[];
  notifications: ActivityNotification[];
  devices: PairedDevice[];
  pairCode: string;
  wsConnected: boolean;
  isOffline: boolean;
  settings: ScannerSettings;
  customFolders: string[];
  user: UserAccount | null;
  onSwitchToMobile: () => void;
  onOpenAuth: () => void;
  onOpenLoginPanel: () => void;
  onPreviewDoc: (doc: ScanDocument) => void;
  onOpenDocPages: (doc: ScanDocument) => void;
  onEditDoc: (doc: ScanDocument, tab?: EditorStudioTab) => void;
  onOpenOcr: (doc: ScanDocument) => void;
  onShareDoc: (doc: ScanDocument) => void;
  onDownloadDoc: (doc: ScanDocument) => void;
  onBatchOcr: (docIds: string[]) => Promise<void>;
  batchOcrRunning: boolean;
  onMarkNotificationsRead: () => void;
  onSaveDocument: (params: {
    dataUrl: string;
    title: string;
    category: DocumentCategory;
    mimeType: string;
    fileExtension: string;
    pageCount?: number;
    pages?: string[];
  }) => Promise<void>;
  onUpdateDocument: (doc: ScanDocument) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
  onUpdateSettings: (next: ScannerSettings) => Promise<void>;
  onAddCustomFolder: (name: string) => Promise<void>;
  onRegeneratePairCode: () => Promise<void>;
  onRemoveDevice: (deviceId: string) => Promise<void>;
  onRetryTransfer: (job: TransferJob) => Promise<void>;
  onClearCompletedTransfers: () => Promise<void>;
  onCloudSyncAll: () => Promise<void>;
  cloudSyncing: boolean;
  driveConnected: boolean;
  onOpenDriveBackup: () => void;
}

export function DesktopWorkbench({
  documents,
  transfers,
  notifications,
  devices,
  pairCode,
  wsConnected,
  isOffline,
  settings,
  customFolders,
  user,
  onSwitchToMobile,
  onOpenAuth,
  onOpenLoginPanel,
  onPreviewDoc,
  onOpenDocPages,
  onEditDoc,
  onOpenOcr,
  onShareDoc,
  onDownloadDoc,
  onBatchOcr,
  batchOcrRunning,
  onMarkNotificationsRead,
  onSaveDocument,
  onUpdateDocument,
  onDeleteDocument,
  onUpdateSettings,
  onAddCustomFolder,
  onRegeneratePairCode,
  onRemoveDevice,
  onRetryTransfer,
  onClearCompletedTransfers,
  onCloudSyncAll,
  cloudSyncing,
  driveConnected,
  onOpenDriveBackup,
}: DesktopWorkbenchProps) {
  const [view, setView] = useState<DesktopView>('dashboard');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('document');
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('ALL');
  const [formatFilter, setFormatFilter] = useState<'ALL' | 'IMG' | 'PDF'>('ALL');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderInput, setNewFolderInput] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const allFolders = useMemo(
    () => [...DEFAULT_FOLDERS, ...customFolders.filter((f) => !DEFAULT_FOLDERS.includes(f as DocumentCategory))],
    [customFolders]
  );

  const stats = useMemo(() => {
    const pdfCount = documents.filter((d) => d.mimeType === 'application/pdf').length;
    const imgCount = documents.length - pdfCount;
    const totalBytes = documents.reduce((acc, d) => acc + (d.sizeBytes || 0), 0);
    const connectedDevices = devices.filter((d) => d.connected).length;
    const pendingTransfers = transfers.filter((t) => t.status === 'queued' || t.status === 'transferring').length;
    return { pdfCount, imgCount, totalBytes, connectedDevices, pendingTransfers };
  }, [documents, devices, transfers]);

  const filteredDocs = useMemo(() => {
    let base = documents;
    if (view === 'images') {
      base = base.filter((d) => d.mimeType.startsWith('image/'));
    } else if (view === 'documents') {
      if (folderFilter !== 'ALL') {
        base = base.filter((d) => d.category === folderFilter || d.folder.endsWith(folderFilter));
      }
    }

    if (formatFilter === 'IMG') base = base.filter((d) => d.mimeType.startsWith('image/'));
    if (formatFilter === 'PDF') base = base.filter((d) => d.mimeType === 'application/pdf');

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q) ||
          d.ocrText.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q) ||
          d.sourceDevice.toLowerCase().includes(q)
      );
    }

    return [...base].sort((a, b) => {
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [documents, view, folderFilter, formatFilter, searchQuery, sortBy]);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleBulkExportPdf = async () => {
    const chosenImgs = documents.filter(
      (d) => selectedIds.includes(d.id) && d.mimeType.startsWith('image/')
    );
    if (chosenImgs.length === 0) return;
    const pdf = await imagesToPdf(chosenImgs.map((c) => c.dataUrl));
    await onSaveDocument({
      dataUrl: pdf.dataUrl,
      title: `Batch_Export_${chosenImgs.length}_Pages`,
      category: 'PDFs',
      mimeType: 'application/pdf',
      fileExtension: 'pdf',
      pageCount: pdf.pageCount,
    });
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    for (const id of selectedIds) {
      await onDeleteDocument(id);
    }
    setSelectedIds([]);
  };

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const navItems: Array<{ id: DesktopView; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'documents', label: 'Document Library', icon: FileText },
    { id: 'images', label: 'Image Library', icon: ImageIcon },
    { id: 'pdf-tools', label: 'PDF Tools', icon: SlidersHorizontal },
    { id: 'ocr', label: 'OCR Search Index', icon: Languages },
    { id: 'pairing', label: 'Mobile Pairing', icon: QrCode },
    { id: 'transfers', label: 'Transfer Queue', icon: RefreshCw },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'storage', label: 'Folders & Rules', icon: HardDrive },
    { id: 'builds', label: 'Native APK & EXE', icon: FileCode2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const activeNavLabel = navItems.find((n) => n.id === view)?.label || 'Dashboard';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col bg-emerald-950 text-slate-100 shrink-0 border-r border-emerald-900">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-emerald-900/70">
          <BrandLogo size={38} />
          <div className="min-w-0">
            <div className="text-sm font-display font-bold text-white leading-tight truncate">
              Oklivo Scanner
            </div>
            <div className="text-xs text-emerald-300/90 font-medium">Desktop Studio</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Desktop Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setView(item.id);
                  if (item.id === 'notifications') onMarkNotificationsRead();
                }}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-800 text-white'
                    : 'text-emerald-100/80 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'transfers' && stats.pendingTransfers > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-emerald-300">
                    {stats.pendingTransfers}
                  </span>
                )}
                {item.id === 'notifications' && unreadNotifications > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-emerald-300">
                    {unreadNotifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-emerald-900/70 space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-emerald-200/80">
            <span>Pair Code</span>
            <span className="font-mono font-bold tabular-nums text-white">{pairCode || '------'}</span>
          </div>
          <div className="flex items-center justify-between text-emerald-200/80">
            <span>Connected Mobiles</span>
            <span className="font-mono tabular-nums text-white">{stats.connectedDevices}</span>
          </div>
          <button
            type="button"
            onClick={onSwitchToMobile}
            className="w-full mt-1 inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-emerald-100 font-medium transition-colors"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Switch to Mobile App
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-5 lg:px-8 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden">
              <BrandLogo size={30} />
            </span>
            <h1 className="text-base font-display font-bold text-slate-900 whitespace-nowrap truncate">
              {activeNavLabel}
            </h1>
          </div>

          <div className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setView('documents')}
              className="hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              Documents
            </button>
            <button
              type="button"
              onClick={() => setView('pdf-tools')}
              className="hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              PDF Tools
            </button>
            <button
              type="button"
              onClick={() => setView('pairing')}
              className="hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              Pair Mobile
            </button>
            <button
              type="button"
              onClick={onSwitchToMobile}
              className="hover:text-emerald-800 whitespace-nowrap shrink-0 inline-flex items-center gap-1"
            >
              <MonitorSmartphone className="w-3.5 h-3.5" />
              Mobile View
            </button>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const latestImg = documents.find((d) => d.mimeType.startsWith('image/'));
                if (latestImg) {
                  onEditDoc(latestImg, 'crop');
                } else {
                  setView('pdf-tools');
                }
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 hover:border-emerald-700 text-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
              title="All-Types Cropper & Manual File Size Resizer"
            >
              <Crop className="w-3.5 h-3.5 text-emerald-700" />
              Crop & Resize KB
            </button>
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
              aria-label={user ? `Account ${user.displayName}` : 'Login'}
            >
              {user ? (
                <>
                  <User className="w-3.5 h-3.5 text-emerald-700" />
                  <span className="max-w-[110px] truncate">{user.displayName}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Login</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setCaptureMode('document');
                setShowScannerModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              New Scan
            </button>
          </div>
        </header>

        {/* Workspace Status & Search Toolbar */}
        <div className="bg-white border-b border-slate-200 px-5 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-slate-600 tabular-nums">
            <span>
              {isOffline ? (
                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                  <WifiOff className="w-3.5 h-3.5" />
                  Offline Mode
                </span>
              ) : (
                <span className="text-emerald-800 font-medium">
                  {wsConnected ? 'Receiver Ready' : 'Connecting Receiver'}
                </span>
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Pairing Code: <strong className="font-mono text-slate-900">{pairCode || '------'}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>{stats.connectedDevices} mobile connected</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenDriveBackup}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                driveConnected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-700" />
              {driveConnected ? 'Google Drive Connected' : 'Save to Google Drive'}
            </button>
            {user && (
              <button
                type="button"
                onClick={onCloudSyncAll}
                disabled={cloudSyncing || isOffline}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-50"
              >
                <CloudUpload className="w-3.5 h-3.5 text-emerald-700" />
                {cloudSyncing ? 'Backing up...' : 'Sync Cloud Backup'}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
            >
              <Cloud className="w-3.5 h-3.5 text-emerald-700" />
              {user ? 'Account & PIN' : 'Cloud & PIN'}
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 p-5 lg:p-8 overflow-y-auto space-y-6">
          {/* DASHBOARD VIEW */}
          {view === 'dashboard' && (
            <div className="space-y-6">
              {/* Action Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">Recent Scans & Transfers</h2>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => importInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Import File
                      </button>
                      <input
                        ref={importInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={handleImportFiles}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setView('documents')}
                        className="text-xs font-medium text-emerald-800 hover:underline"
                      >
                        View All
                      </button>
                    </div>
                  </div>

                  {documents.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-sm text-slate-600">No documents scanned yet.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setCaptureMode('quick');
                          setShowScannerModal(true);
                        }}
                        className="px-4 py-2 text-xs font-semibold bg-emerald-800 text-white rounded-xl"
                      >
                        Capture First Document
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {documents.slice(0, 6).map((doc) => (
                        <div key={doc.id} className="py-3 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => onPreviewDoc(doc)}
                            className="flex items-center gap-3 min-w-0 text-left flex-1"
                          >
                            {doc.mimeType === 'application/pdf' ? (
                              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5 text-emerald-800" />
                              </div>
                            ) : (
                              <img
                                src={doc.dataUrl}
                                alt={doc.title}
                                className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 truncate">{doc.title}</div>
                              <div className="text-xs text-slate-500 tabular-nums truncate">
                                {doc.category} · {formatBytes(doc.sizeBytes)} · {doc.sourceDevice} ·{' '}
                                {new Date(doc.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => onOpenDocPages(doc)}
                              className="p-2 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                              title="Pages & Scan Filters"
                            >
                              <Layers className="w-4 h-4" />
                            </button>
                            {doc.mimeType.startsWith('image/') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onEditDoc(doc, 'crop')}
                                  className="p-2 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                  title="All-Types Crop & Resize KB"
                                >
                                  <Crop className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onEditDoc(doc, 'clean')}
                                  className="p-2 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                  title="Clean, Beauty & Enhance"
                                >
                                  <SlidersHorizontal className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenOcr(doc)}
                              className="p-2 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                              title="OCR Text"
                            >
                              <Languages className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onShareDoc(doc)}
                              className="p-2 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                              title="Share Across Platforms"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDownloadDoc(doc)}
                              className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Mobile Pairing Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Laptop className="w-4 h-4 text-emerald-800" />
                      Instant Mobile-to-PC Receiver
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Open the Mobile Companion on your phone or in a second browser tab with pairing code{' '}
                      <strong className="font-mono text-emerald-900">{pairCode}</strong>. Captures stream here automatically.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-2">
                    <div className="text-xs text-slate-500">Active Pairing Code</div>
                    <div className="text-2xl font-mono font-bold tracking-widest tabular-nums text-emerald-950">
                      {pairCode || '------'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setView('pairing')}
                      className="py-2.5 px-3 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl"
                    >
                      Show QR Code
                    </button>
                    <button
                      type="button"
                      onClick={onSwitchToMobile}
                      className="py-2.5 px-3 text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl"
                    >
                      Open Mobile UI
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DOCUMENT / IMAGE / OCR SEARCH LIBRARIES */}
          {(view === 'documents' || view === 'images' || view === 'ocr') && (
            <div className="space-y-4">
              {/* Filter & Search Bar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search filename, OCR Hindi/English text, folder, or device..."
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {view === 'documents' && (
                    <select
                      value={folderFilter}
                      onChange={(e) => setFolderFilter(e.target.value)}
                      className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="ALL">All Folders</option>
                      {allFolders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={formatFilter}
                    onChange={(e) => setFormatFilter(e.target.value as 'ALL' | 'IMG' | 'PDF')}
                    className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="ALL">All Formats</option>
                    <option value="IMG">Images Only</option>
                    <option value="PDF">PDFs Only</option>
                  </select>

                  <button
                    type="button"
                    onClick={() =>
                      setSortBy((s) => (s === 'date' ? 'name' : s === 'name' ? 'size' : 'date'))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    Sort: {sortBy}
                  </button>

                  <div className="flex p-0.5 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setLayoutMode('grid')}
                      className={`p-1.5 rounded-lg ${layoutMode === 'grid' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
                      aria-label="Grid view"
                    >
                      <Grid className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode('list')}
                      className={`p-1.5 rounded-lg ${layoutMode === 'list' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
                      aria-label="List view"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Bulk Selection Bar */}
              {selectedIds.length > 0 && (
                <div className="bg-emerald-950 text-white px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="font-medium tabular-nums">{selectedIds.length} selected</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={batchOcrRunning}
                      onClick={() => void onBatchOcr(selectedIds)}
                      className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 rounded-lg font-semibold disabled:opacity-50"
                    >
                      {batchOcrRunning ? 'Running Batch OCR...' : 'Batch OCR (EN + HI)'}
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkExportPdf}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg font-semibold"
                    >
                      Combine Selected to PDF
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg font-semibold"
                    >
                      Delete Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="px-2.5 py-1.5 text-emerald-200 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Library Items */}
              {filteredDocs.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
                  <Search className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-sm text-slate-600">No matching documents found.</p>
                </div>
              ) : layoutMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredDocs.map((doc) => {
                    const checked = selectedIds.includes(doc.id);
                    return (
                      <div
                        key={doc.id}
                        className={`bg-white border rounded-2xl overflow-hidden flex flex-col transition-colors ${
                          checked ? 'border-emerald-700 ring-1 ring-emerald-700' : 'border-slate-200'
                        }`}
                      >
                        <div className="relative h-44 bg-slate-100 flex items-center justify-center overflow-hidden">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedIds((prev) =>
                                prev.includes(doc.id)
                                  ? prev.filter((x) => x !== doc.id)
                                  : [...prev, doc.id]
                              )
                            }
                            aria-label={`Select ${doc.title}`}
                            className="absolute top-2.5 left-2.5 z-10 w-4 h-4 accent-emerald-700"
                          />
                          {doc.mimeType === 'application/pdf' ? (
                            <div className="text-center space-y-1">
                              <FileText className="w-10 h-10 text-emerald-800 mx-auto" />
                              <div className="text-xs font-mono text-slate-600 tabular-nums">
                                PDF · {doc.pageCount}p
                              </div>
                            </div>
                          ) : (
                            <img
                              src={doc.dataUrl}
                              alt={doc.title}
                              className="w-full h-full object-cover cursor-pointer"
                              onClick={() => onPreviewDoc(doc)}
                            />
                          )}
                        </div>

                        <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2.5">
                          <div>
                            {renamingId === doc.id ? (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  await onUpdateDocument({ ...doc, title: renameValue.trim() || doc.title });
                                  setRenamingId(null);
                                }}
                                className="flex gap-1"
                              >
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  className="flex-1 px-2 py-1 text-xs border border-emerald-600 rounded"
                                  autoFocus
                                />
                                <button type="submit" className="px-2 py-1 text-xs bg-emerald-800 text-white rounded">
                                  Save
                                </button>
                              </form>
                            ) : (
                              <div className="text-sm font-semibold text-slate-900 truncate">{doc.title}</div>
                            )}
                            <div className="text-xs text-slate-500 tabular-nums mt-0.5 truncate">
                              {doc.category} · {formatBytes(doc.sizeBytes)} · {doc.fileExtension.toUpperCase()}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onPreviewDoc(doc)}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="Preview"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenDocPages(doc)}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="Pages & Filters"
                              >
                                <Layers className="w-3.5 h-3.5" />
                              </button>
                              {doc.mimeType.startsWith('image/') && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onEditDoc(doc, 'crop')}
                                    className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                    title="All-Types Crop & Resize KB"
                                  >
                                    <Crop className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onEditDoc(doc, 'clean')}
                                    className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                    title="Edit Image, Clean & Beauty"
                                  >
                                    <SlidersHorizontal className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => onOpenOcr(doc)}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="OCR Text"
                              >
                                <Languages className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onShareDoc(doc)}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="Share Across Platforms"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDownloadDoc(doc)}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="Download (Choose Format)"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingId(doc.id);
                                  setRenameValue(doc.title);
                                }}
                                className="p-1.5 text-slate-500 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                                title="Rename"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => onDeleteDocument(doc.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-3 px-4 w-8"></th>
                        <th className="py-3 px-4 font-semibold">Document</th>
                        <th className="py-3 px-4 font-semibold">Folder</th>
                        <th className="py-3 px-4 font-semibold">Source</th>
                        <th className="py-3 px-4 font-semibold text-right">Size</th>
                        <th className="py-3 px-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDocs.map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(doc.id)}
                              onChange={() =>
                                setSelectedIds((prev) =>
                                  prev.includes(doc.id)
                                    ? prev.filter((x) => x !== doc.id)
                                    : [...prev, doc.id]
                                )
                              }
                              className="accent-emerald-700"
                            />
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{doc.title}</td>
                          <td className="py-2.5 px-4 text-slate-600">{doc.category}</td>
                          <td className="py-2.5 px-4 text-slate-600">{doc.sourceDevice}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                            {formatBytes(doc.sizeBytes)}
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => onPreviewDoc(doc)}
                              className="text-emerald-800 font-medium hover:underline"
                            >
                              Open
                            </button>
                            {doc.mimeType.startsWith('image/') && (
                              <button
                                type="button"
                                onClick={() => onEditDoc(doc, 'crop')}
                                className="text-emerald-800 font-medium hover:underline"
                              >
                                Crop/KB
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenOcr(doc)}
                              className="text-slate-700 hover:underline"
                            >
                              OCR
                            </button>
                            <button
                              type="button"
                              onClick={() => onShareDoc(doc)}
                              className="text-emerald-800 font-medium hover:underline"
                            >
                              Share
                            </button>
                            <button
                              type="button"
                              onClick={() => onDownloadDoc(doc)}
                              className="text-slate-700 hover:underline"
                            >
                              Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* PDF TOOLS */}
          {view === 'pdf-tools' && (
            <PdfToolboxView documents={documents} onSaveGeneratedDocument={onSaveDocument} />
          )}

          {/* MOBILE PAIRING */}
          {view === 'pairing' && (
            <DesktopPairingPanel
              pairCode={pairCode}
              wsConnected={wsConnected}
              devices={devices}
              onRegenerateCode={onRegeneratePairCode}
              onRemoveDevice={onRemoveDevice}
            />
          )}

          {/* TRANSFER QUEUE */}
          {view === 'transfers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Transfer Queue & History</h2>
                  <p className="text-sm text-slate-500">
                    Automatic mobile-to-PC transfers, retry tracking, and offline queue status.
                  </p>
                </div>
                {transfers.some((t) => t.status === 'completed') && (
                  <button
                    type="button"
                    onClick={onClearCompletedTransfers}
                    className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-xl bg-white hover:bg-slate-50"
                  >
                    Clear Completed
                  </button>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                {transfers.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No transfer jobs recorded yet. Capture a scan on Mobile to see live transfers here.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {transfers.map((job) => (
                      <div key={job.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{job.title}</div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {job.fileName} · {formatBytes(job.sizeBytes)} · Channel {job.pairCode} ·{' '}
                            {new Date(job.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`text-xs font-semibold capitalize ${
                              job.status === 'completed'
                                ? 'text-emerald-700'
                                : job.status === 'failed'
                                ? 'text-red-600'
                                : 'text-amber-700'
                            }`}
                          >
                            {job.status} ({job.progress}%)
                          </span>
                          {(job.status === 'failed' || job.status === 'queued') && (
                            <button
                              type="button"
                              onClick={() => onRetryTransfer(job)}
                              className="px-3 py-1.5 text-xs font-medium bg-emerald-800 text-white rounded-lg"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FOLDERS & STORAGE RULES */}
          {view === 'storage' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Automatic File & Folder Rules</h2>
                <p className="text-sm text-slate-500">
                  Configure directory taxonomy, naming templates, and collision-safe retention.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900">Managed Directory Structure</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {allFolders.map((folder) => {
                      const count = documents.filter((d) => d.category === folder).length;
                      return (
                        <div
                          key={folder}
                          className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs"
                        >
                          <span className="flex items-center gap-2 font-medium text-slate-800 truncate">
                            <Folder className="w-4 h-4 text-emerald-700 shrink-0" />
                            <span className="truncate">{folder}/</span>
                          </span>
                          <span className="font-mono tabular-nums text-slate-500">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newFolderInput.trim()) return;
                      await onAddCustomFolder(newFolderInput.trim());
                      setNewFolderInput('');
                    }}
                    className="flex gap-2 pt-2"
                  >
                    <input
                      type="text"
                      value={newFolderInput}
                      onChange={(e) => setNewFolderInput(e.target.value)}
                      placeholder="New custom folder name..."
                      className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-800 text-white rounded-xl"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      Add Folder
                    </button>
                  </form>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900">Naming & Default Routing</h3>
                  <label className="block text-xs text-slate-700">
                    File Naming Template
                    <input
                      type="text"
                      value={settings.namingTemplate}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, namingTemplate: e.target.value })
                      }
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs"
                    />
                    <span className="text-[11px] text-slate-400">
                      Tokens: YYYY, MM, DD, HH, mm, ss · Auto-appends _1, _2 on duplicate names
                    </span>
                  </label>
                  <label className="block text-xs text-slate-700">
                    Default Destination Folder
                    <select
                      value={settings.destinationFolder}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          destinationFolder: e.target.value as DocumentCategory,
                        })
                      }
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    >
                      {DEFAULT_FOLDERS.map((f) => (
                        <option key={f} value={f}>
                          Documents/{f}/
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">Google Drive Backup</span>
                      <div className="text-[11px] text-slate-500">
                        {driveConnected
                          ? 'Connected to Oklivo Scanner folder'
                          : 'Back up all scans, PDFs, and settings to Google Drive'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenDriveBackup}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl shrink-0"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      {driveConnected ? 'Manage Drive' : 'Connect Drive'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS & ACTIVITY CENTER */}
          {view === 'notifications' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Notifications & Activity Log</h2>
                <p className="text-sm text-slate-500">
                  Real-time log of received mobile transfers, background OCR extractions, and cloud backup events.
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No activity notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="p-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                        <div className="text-xs text-slate-600 mt-0.5">{n.detail}</div>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                        {new Date(n.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* NATIVE BUILDS & DOCS */}
          {view === 'builds' && <NativeBuildsView />}

          {/* SETTINGS */}
          {view === 'settings' && (
            <div className="max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Application & Offline Preferences</h2>

              <label className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Auto-Save New Scans to Google Drive</div>
                  <div className="text-xs text-slate-500">
                    Automatically save scanned documents &amp; PDFs to your &ldquo;Oklivo Scanner&rdquo; Google Drive folder when signed in
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDriveBackup ?? true}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, autoDriveBackup: e.target.checked })
                  }
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Auto-OCR on Capture (Background)</div>
                  <div className="text-xs text-slate-500">
                    Automatically extract English & Hindi searchable text in background without slowing Quick Capture
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoOcrOnCapture}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, autoOcrOnCapture: e.target.checked })
                  }
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Simulate Offline Mode</div>
                  <div className="text-xs text-slate-500">
                    Test offline scanning, local IndexedDB persistence, and automatic transfer queue resumption
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.offlineModeSimulated}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, offlineModeSimulated: e.target.checked })
                  }
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Auto-Enhance Document Scans</div>
                  <div className="text-xs text-slate-500">
                    Apply shadow cleanup and contrast boost in background after Quick Capture
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoEnhance}
                  onChange={(e) => onUpdateSettings({ ...settings, autoEnhance: e.target.checked })}
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Auto-Transfer Mobile Scans to PC</div>
                  <div className="text-xs text-slate-500">
                    Stream captured pages automatically without tapping Share
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoTransfer}
                  onChange={(e) => onUpdateSettings({ ...settings, autoTransfer: e.target.checked })}
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-slate-900">Retain Copy on Mobile After Transfer</div>
                  <div className="text-xs text-slate-500">
                    Never delete local mobile scans automatically after PC confirmation
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.retainMobileCopy}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, retainMobileCopy: e.target.checked })
                  }
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              <div className="pt-4 mt-2 border-t border-slate-200 flex items-center gap-4">
                <BrandLogo size={56} />
                <div className="min-w-0">
                  <div className="text-sm font-display font-bold text-slate-900">
                    Oklivo Scanner
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Multifunctional Document & Image Scanning Ecosystem · Offline IndexedDB · LAN WebSocket Sync · Hindi & English OCR
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Embedded Desktop Camera Scanner Modal */}
      {showScannerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm p-3 md:p-6 flex items-center justify-center">
          <div className="w-full max-w-5xl h-[88vh]">
            <ScannerCameraStudio
              mode={captureMode}
              settings={settings}
              onModeChange={setCaptureMode}
              onQuickCaptureSave={onSaveDocument}
              onClose={() => setShowScannerModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
