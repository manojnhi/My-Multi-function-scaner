import {
  Camera,
  CreditCard,
  Crop,
  FileText,
  FolderOpen,
  HardDrive,
  Home,
  Image as ImageIcon,
  Laptop,
  Languages,
  Layers,
  LogIn,
  Monitor,
  RefreshCw,
  ScanLine,
  Settings,
  Share2,
  SlidersHorizontal,
  Upload,
  User,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes } from '../services/db';
import type {
  DocumentCategory,
  MobileView,
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
  onPreviewDoc: (doc: ScanDocument) => void;
  onEditDoc: (doc: ScanDocument, tab?: EditorStudioTab) => void;
  onOpenOcr: (doc: ScanDocument) => void;
  onShareDoc: (doc: ScanDocument) => void;
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
  onOpenLoginPanel,
  onSaveDocument,
  onPreviewDoc,
  onEditDoc,
  onOpenOcr,
  onShareDoc,
  onUpdateSettings,
  onRetryTransfer,
  driveConnected,
  onOpenDriveBackup,
}: MobileCompanionProps) {
  const [view, setView] = useState<MobileView>('dashboard');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('quick');
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

  const pendingTransfers = transfers.filter((t) => t.status === 'queued' || t.status === 'transferring').length;

  const shortcutTiles = [
    { id: 'quick', label: 'Quick Scan', desc: '1-tap instant capture', icon: Zap, action: () => openCameraInMode('quick') },
    { id: 'doc', label: 'Document Scan', desc: 'A4, receipts, forms', icon: FileText, action: () => openCameraInMode('document') },
    { id: 'auto', label: 'Auto Capture', desc: 'Hands-free steady trigger', icon: ScanLine, action: () => openCameraInMode('auto') },
    { id: 'image', label: 'Image Scan', desc: 'Enhance, compress, resize', icon: ImageIcon, action: () => openCameraInMode('image') },
    { id: 'idcard', label: 'ID Card Scan', desc: 'Front + Back single PDF', icon: CreditCard, action: () => openCameraInMode('id-card') },
    { id: 'batch', label: 'Batch Scan', desc: 'Multi-page continuous', icon: Layers, action: () => openCameraInMode('batch') },
    { id: 'gallery', label: 'Gallery Import', desc: 'Select device photos', icon: Upload, action: () => galleryInputRef.current?.click() },
    {
      id: 'crop-resize',
      label: 'Crop & Resize KB',
      desc: 'All-types crop & exact KB',
      icon: Crop,
      action: () => {
        const latestImg = documents.find((d) => d.mimeType.startsWith('image/'));
        if (latestImg) {
          onEditDoc(latestImg, 'crop');
        } else {
          galleryInputRef.current?.click();
        }
      },
    },
    {
      id: 'ocr-scan',
      label: 'OCR Scanner',
      desc: 'Extract EN & HI text',
      icon: Languages,
      action: () => {
        const firstDoc = documents[0];
        if (firstDoc) {
          onOpenOcr(firstDoc);
        } else {
          openCameraInMode('document');
        }
      },
    },
    { id: 'pdf', label: 'PDF Tools', desc: 'Merge, split, crop, password', icon: SlidersHorizontal, action: () => setView('pdf-tools') },
    {
      id: 'drive',
      label: 'Google Drive',
      desc: driveConnected ? 'Connected · Backup & sync' : 'Save scans to Google Drive',
      icon: HardDrive,
      action: onOpenDriveBackup,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col pb-20">
      {/* Compact Sticky Mobile Top App Bar (<= 56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandLogo size={28} />
          <span className="text-sm font-display font-bold text-slate-900 truncate">
            My Multi Functional Scanner
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg whitespace-nowrap shrink-0"
            aria-label={user ? `Account ${user.displayName}` : 'Login'}
          >
            {user ? (
              <>
                <User className="w-3.5 h-3.5 text-emerald-700" />
                <span className="max-w-[84px] truncate">{user.displayName.split(' ')[0]}</span>
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
            onClick={onSwitchToDesktop}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop Workbench
          </button>
          <button
            type="button"
            onClick={() => setView('settings')}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-700"
            aria-label="Mobile Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryImport}
        className="hidden"
      />

      {/* Responsive Content Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-6 space-y-5">
        {view === 'dashboard' && (
          <>
            {/* Connection & Sync Strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setView('connect-pc')}
                className="bg-emerald-950 text-white rounded-2xl p-4 text-left flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs text-emerald-300">Connected PC Status</div>
                  <div className="text-sm font-semibold mt-0.5">
                    {pairCode && wsConnected
                      ? desktopOnline
                        ? `Paired (${pairCode}) · Ready`
                        : `Paired (${pairCode}) · PC Offline`
                      : 'Tap to Pair Windows PC'}
                  </div>
                </div>
                <Laptop className="w-6 h-6 text-emerald-300 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setView('transfers')}
                className="bg-white border border-slate-200 rounded-2xl p-4 text-left flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs text-slate-500">Transfer Queue</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {pendingTransfers > 0 ? `${pendingTransfers} pending auto-transfer` : `${transfers.length} total transfers`}
                  </div>
                </div>
                <RefreshCw className="w-5 h-5 text-emerald-700 shrink-0" />
              </button>

              <button
                type="button"
                onClick={onOpenAuth}
                className="bg-white border border-slate-200 rounded-2xl p-4 text-left flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs text-slate-500">Sync & Offline State</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {isOffline ? (
                      <span className="text-amber-700 inline-flex items-center gap-1">
                        <WifiOff className="w-3.5 h-3.5" /> Offline-First Active
                      </span>
                    ) : user ? (
                      `Signed in · ${user.displayName}`
                    ) : (
                      'Local Mode · Tap for Cloud'
                    )}
                  </div>
                </div>
                <FolderOpen className="w-5 h-5 text-emerald-700 shrink-0" />
              </button>
            </div>

            {/* Prominent Quick Capture Hero CTA */}
            <button
              type="button"
              onClick={() => openCameraInMode('quick')}
              className="w-full bg-emerald-800 hover:bg-emerald-900 text-white rounded-2xl p-5 flex items-center justify-between gap-4 transition-colors min-h-[72px]"
            >
              <div className="text-left">
                <div className="text-base font-display font-bold">Open Quick Capture Camera</div>
                <div className="text-xs text-emerald-100 mt-0.5">
                  One-tap capture · Instant local save · Auto-transfer to paired PC
                </div>
              </div>
              <div className="w-12 h-12 rounded-full bg-white text-emerald-900 flex items-center justify-center shrink-0">
                <Camera className="w-6 h-6" />
              </div>
            </button>

            {/* Multifunctional Tools Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {shortcutTiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={tile.action}
                    className="bg-white border border-slate-200 hover:border-emerald-700 rounded-2xl p-4 text-left flex flex-col justify-between gap-3 min-h-[104px] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{tile.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{tile.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Recent Mobile Scans */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Recent Documents</h2>
                <button
                  type="button"
                  onClick={() => setView('documents')}
                  className="text-xs font-medium text-emerald-800"
                >
                  See all ({documents.length})
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {documents.slice(0, 5).map((doc) => (
                  <div key={doc.id} className="py-2.5 flex items-center justify-between gap-3 min-h-[56px]">
                    <button
                      type="button"
                      onClick={() => onPreviewDoc(doc)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                    >
                      {doc.mimeType === 'application/pdf' ? (
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                      ) : (
                        <img
                          src={doc.dataUrl}
                          alt={doc.title}
                          className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{doc.title}</div>
                        <div className="text-xs text-slate-500 tabular-nums truncate">
                          {doc.category} · {formatBytes(doc.sizeBytes)}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onShareDoc(doc)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                        aria-label={`Share ${doc.title}`}
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenOcr(doc)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                        aria-label={`OCR ${doc.title}`}
                      >
                        <Languages className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {view === 'quick-capture' && (
          <div className="h-[74vh] min-h-[500px]">
            <ScannerCameraStudio
              mode={captureMode}
              settings={settings}
              onModeChange={setCaptureMode}
              onQuickCaptureSave={onSaveDocument}
              onClose={() => setView('dashboard')}
            />
          </div>
        )}

        {view === 'documents' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">Mobile Document Library</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => onPreviewDoc(doc)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    {doc.mimeType === 'application/pdf' ? (
                      <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                    ) : (
                      <img
                        src={doc.dataUrl}
                        alt={doc.title}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{doc.title}</div>
                      <div className="text-xs text-slate-500 tabular-nums truncate">
                        {doc.category} · {formatBytes(doc.sizeBytes)}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {doc.mimeType.startsWith('image/') && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEditDoc(doc, 'crop')}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                          aria-label="Crop and Resize KB"
                        >
                          <Crop className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditDoc(doc, 'clean')}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                          aria-label="Edit scan"
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenOcr(doc)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                      aria-label="Run OCR"
                    >
                      <Languages className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onShareDoc(doc)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-800"
                      aria-label="Share document"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'pdf-tools' && (
          <PdfToolboxView documents={documents} onSaveGeneratedDocument={onSaveDocument} />
        )}

        {view === 'connect-pc' && (
          <MobileConnectPanel
            currentPairCode={pairCode}
            wsConnected={wsConnected}
            desktopOnline={desktopOnline}
            deviceName={deviceName}
            onDeviceNameChange={onDeviceNameChange}
            onPairWithCode={onPairWithCode}
            onDisconnect={onDisconnectPc}
          />
        )}

        {view === 'transfers' && (
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
        )}

        {view === 'settings' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 max-w-xl">
            <h2 className="text-base font-bold text-slate-900">Quick Capture & Transfer Settings</h2>
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
                onChange={(e) => onUpdateSettings({ ...settings, autoOcrOnCapture: e.target.checked })}
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
              className="w-full py-3 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl min-h-[44px] inline-flex items-center justify-center gap-2"
            >
              <HardDrive className="w-4 h-4" />
              {driveConnected ? 'Google Drive Backup Connected (Manage)' : 'Save All Data to Google Drive'}
            </button>
            {!user && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="w-full py-3 border border-emerald-700 text-emerald-900 hover:bg-emerald-50 text-xs font-semibold rounded-xl min-h-[44px]"
              >
                Sign In / Create Cloud Account
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToDesktop}
              className="w-full py-3 bg-slate-900 text-white text-xs font-semibold rounded-xl min-h-[44px]"
            >
              Switch to Windows Desktop Workbench
            </button>
          </div>
        )}
      </main>

      {/* Thumb-Zone Bottom Tab Bar (56px fixed) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center"
        aria-label="Mobile Tab Navigation"
      >
        <button
          type="button"
          onClick={() => setView('dashboard')}
          className={`flex flex-col items-center justify-center h-full ${
            view === 'dashboard' ? 'text-emerald-800' : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Home</span>
        </button>
        <button
          type="button"
          onClick={() => openCameraInMode('quick')}
          className={`flex flex-col items-center justify-center h-full ${
            view === 'quick-capture' ? 'text-emerald-800' : 'text-slate-500'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Capture</span>
        </button>
        <button
          type="button"
          onClick={() => setView('documents')}
          className={`flex flex-col items-center justify-center h-full ${
            view === 'documents' ? 'text-emerald-800' : 'text-slate-500'
          }`}
        >
          <FileText className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Library</span>
        </button>
        <button
          type="button"
          onClick={() => setView('connect-pc')}
          className={`flex flex-col items-center justify-center h-full ${
            view === 'connect-pc' || view === 'transfers' ? 'text-emerald-800' : 'text-slate-500'
          }`}
        >
          <Laptop className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">PC Sync</span>
        </button>
      </nav>
    </div>
  );
}
