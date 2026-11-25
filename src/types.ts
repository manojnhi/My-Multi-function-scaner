export type DocumentCategory =
  | 'Scans'
  | 'Images'
  | 'PDFs'
  | 'ID_Cards'
  | 'Receipts'
  | 'Certificates'
  | 'Imported'
  | 'Mobile_Transfers';

export type DocumentFilterMode = 'color' | 'grayscale' | 'bw' | 'original';

export type PaperSize = 'A4' | 'A3' | 'Letter' | 'Legal' | 'Custom';

export type SyncStatus = 'local' | 'queued' | 'synced' | 'conflict';

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'failed';

export type OcrLanguage = 'eng' | 'hin' | 'eng+hin';

export interface CornerPoint {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

export interface ScanDocument {
  id: string;
  title: string;
  fileName: string;
  category: DocumentCategory;
  folder: string;
  mimeType: string;
  fileExtension: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  pageCount: number;
  dataUrl: string; // Primary image or PDF data URL
  thumbnailUrl?: string;
  pages?: string[]; // Individual page image data URLs for multi-page / batch / PDF
  ocrText: string;
  ocrLanguage?: OcrLanguage;
  ocrStatus: 'idle' | 'processing' | 'done' | 'error';
  filterMode: DocumentFilterMode;
  sourceDevice: string;
  sha256: string;
  version: number;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TransferJob {
  id: string;
  documentId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  pairCode: string;
  targetDeviceName: string;
  status: TransferStatus;
  progress: number;
  retries: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: 'Android' | 'Mobile Web' | 'Windows' | 'Web';
  pairCode: string;
  connected: boolean;
  lastSeen: string;
  pairedAt: string;
}

export interface ScannerSettings {
  resolution: 'high' | 'medium' | 'fast';
  jpegQuality: number; // 0.4 .. 1.0
  defaultFormat: 'image/jpeg' | 'image/png' | 'image/webp';
  autoCrop: boolean;
  autoEnhance: boolean;
  autoTransfer: boolean;
  defaultFilter: DocumentFilterMode;
  destinationFolder: DocumentCategory;
  namingTemplate: string; // e.g. Scan_YYYY-MM-DD_HH-mm-ss
  retainMobileCopy: boolean;
  autoCloudBackup: boolean;
  autoDriveBackup?: boolean;
  offlineModeSimulated: boolean;
  autoCaptureSensitivity: number; // 1 .. 10
  ocrDefaultLang: OcrLanguage;
  autoOcrOnCapture: boolean;
  appLockPinHash?: string;
}

export interface ActivityNotification {
  id: string;
  title: string;
  detail: string;
  category: 'transfer' | 'ocr' | 'cloud' | 'system';
  timestamp: string;
  read: boolean;
}

export interface UserAccount {
  id: string;
  email: string;
  phone?: string;
  provider?: 'password' | 'google' | 'github' | 'microsoft' | 'apple' | 'phone';
  displayName: string;
  verified: boolean;
  createdAt: string;
}

export interface WifiCameraSource {
  id: string;
  name: string;
  snapshotUrl: string;
  pollMs: number;
  kind: 'http-snapshot' | 'virtual-demo';
}

export interface DriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  webViewLink?: string;
  scannerDocId?: string;
  category?: string;
}

export type WorkspaceMode = 'desktop' | 'mobile';

export type DesktopView =
  | 'dashboard'
  | 'documents'
  | 'images'
  | 'pdf-tools'
  | 'ocr'
  | 'pairing'
  | 'transfers'
  | 'notifications'
  | 'search'
  | 'storage'
  | 'builds'
  | 'settings';

export type MobileView =
  | 'dashboard'
  | 'tools'
  | 'me'
  | 'quick-capture'
  | 'auto-capture'
  | 'doc-scan'
  | 'image-scan'
  | 'id-card'
  | 'batch-scan'
  | 'documents'
  | 'pdf-tools'
  | 'ocr'
  | 'connect-pc'
  | 'transfers'
  | 'settings';
