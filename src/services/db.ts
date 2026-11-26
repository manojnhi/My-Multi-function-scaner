import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  DocumentCategory,
  ScanDocument,
  ScannerSettings,
  TransferJob,
  WifiCameraSource,
} from '../types';

export const DEFAULT_FOLDERS: DocumentCategory[] = [
  'Scans',
  'Images',
  'PDFs',
  'ID_Cards',
  'Receipts',
  'Certificates',
  'Imported',
  'Mobile_Transfers',
];

export const DEFAULT_SETTINGS: ScannerSettings = {
  resolution: 'high',
  jpegQuality: 0.88,
  defaultFormat: 'image/jpeg',
  autoCrop: true,
  autoEnhance: true,
  autoTransfer: true,
  defaultFilter: 'color',
  destinationFolder: 'Scans',
  namingTemplate: 'Scan_YYYY-MM-DD_HH-mm-ss',
  retainMobileCopy: true,
  autoCloudBackup: false,
  autoDriveBackup: true,
  offlineModeSimulated: false,
  autoCaptureSensitivity: 7,
  ocrDefaultLang: 'eng+hin',
  autoOcrOnCapture: false,
};

interface ScannerDBSchema extends DBSchema {
  documents: {
    key: string;
    value: ScanDocument;
    indexes: { 'by-date': string; 'by-category': string; 'by-hash': string };
  };
  transfers: {
    key: string;
    value: TransferJob;
    indexes: { 'by-status': string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<ScannerDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<ScannerDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ScannerDBSchema>('my_multifunctional_scanner_db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('by-date', 'createdAt');
          docStore.createIndex('by-category', 'category');
          docStore.createIndex('by-hash', 'sha256');
        }
        if (!db.objectStoreNames.contains('transfers')) {
          const txStore = db.createObjectStore('transfers', { keyPath: 'id' });
          txStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function computeSha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPin(pin: string): Promise<string> {
  return computeSha256(`scanner_pin_salt:${pin}`);
}

export function formatFileNameFromTemplate(
  template: string,
  ext: string,
  existingNames: Set<string>,
  prefixOverride?: string
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  let base = (prefixOverride ? `${prefixOverride}_YYYY-MM-DD_HH-mm-ss` : template || 'Scan_YYYY-MM-DD_HH-mm-ss')
    .replace(/YYYY/g, yyyy)
    .replace(/MM/g, mm)
    .replace(/DD/g, dd)
    .replace(/HH/g, hh)
    .replace(/mm/g, min)
    .replace(/ss/g, ss)
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'jpg';
  let candidate = `${base}.${cleanExt}`;
  let counter = 1;
  while (existingNames.has(candidate)) {
    candidate = `${base}_${counter}.${cleanExt}`;
    counter++;
  }
  return candidate;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function getAllDocuments(): Promise<ScanDocument[]> {
  const db = await getDb();
  const list = await db.getAll('documents');
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveDocument(doc: ScanDocument): Promise<void> {
  const db = await getDb();
  await db.put('documents', doc);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('documents', id);
}

export async function getAllTransfers(): Promise<TransferJob[]> {
  const db = await getDb();
  const list = await db.getAll('transfers');
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTransfer(job: TransferJob): Promise<void> {
  const db = await getDb();
  await db.put('transfers', job);
}

export async function deleteTransfer(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('transfers', id);
}

export async function getSettings(): Promise<ScannerSettings> {
  const db = await getDb();
  const row = await db.get('meta', 'settings');
  if (!row || !row.value) return { ...DEFAULT_SETTINGS };
  const merged = { ...DEFAULT_SETTINGS, ...(row.value as Partial<ScannerSettings>) };
  return {
    ...merged,
    autoDriveBackup: merged.autoDriveBackup ?? true,
  };
}

export async function saveSettings(settings: ScannerSettings): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'settings', value: settings });
}

import { EMPTY_FOLDER_PREFS, type FolderPrefs } from './folderMath';
import type { SavedPcAddress } from './pcAddressMath';

export async function getCustomFolders(): Promise<string[]> {
  const db = await getDb();
  const row = await db.get('meta', 'custom_folders');
  return row && Array.isArray(row.value) ? (row.value as string[]) : [];
}

export async function saveCustomFolders(folders: string[]): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'custom_folders', value: folders });
}

export async function getFolderPrefs(): Promise<FolderPrefs> {
  const db = await getDb();
  const row = await db.get('meta', 'folder_prefs');
  if (row && row.value && typeof row.value === 'object') {
    const val = row.value as Partial<FolderPrefs>;
    return {
      customFolders: Array.isArray(val.customFolders) ? val.customFolders : [],
      renamedLabels: val.renamedLabels && typeof val.renamedLabels === 'object' ? val.renamedLabels : {},
      hiddenDefaults: Array.isArray(val.hiddenDefaults) ? val.hiddenDefaults : [],
    };
  }
  const legacyCustom = await getCustomFolders();
  return { ...EMPTY_FOLDER_PREFS, customFolders: legacyCustom };
}

export async function saveFolderPrefs(prefs: FolderPrefs): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'folder_prefs', value: prefs });
  await db.put('meta', { key: 'custom_folders', value: prefs.customFolders });
}

export async function getDeviceId(): Promise<string> {
  const db = await getDb();
  const row = await db.get('meta', 'device_id');
  if (row && typeof row.value === 'string') return row.value;
  const created = crypto.randomUUID();
  await db.put('meta', { key: 'device_id', value: created });
  return created;
}

export async function getSavedPairCode(): Promise<string> {
  const db = await getDb();
  const row = await db.get('meta', 'pair_code');
  return row && typeof row.value === 'string' ? row.value : '';
}

export async function savePairCode(code: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'pair_code', value: code });
}

export async function getSavedPcAddresses(): Promise<SavedPcAddress[]> {
  const db = await getDb();
  const row = await db.get('meta', 'saved_pc_addresses');
  return row && Array.isArray(row.value) ? (row.value as SavedPcAddress[]) : [];
}

export async function savePcAddresses(list: SavedPcAddress[]): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'saved_pc_addresses', value: list });
}

export async function getSelectedPcAddressId(): Promise<string> {
  const db = await getDb();
  const row = await db.get('meta', 'selected_pc_address_id');
  return row && typeof row.value === 'string' ? row.value : '';
}

export async function saveSelectedPcAddressId(id: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'selected_pc_address_id', value: id });
}

export const DEFAULT_WIFI_CAMERAS: WifiCameraSource[] = [
  {
    id: 'virtual-wifi-cam',
    name: 'Virtual Wi-Fi Desk Cam (Live Test)',
    snapshotUrl: 'virtual://desk-scanner-cam',
    pollMs: 600,
    kind: 'virtual-demo',
  },
  {
    id: 'android-ip-webcam',
    name: 'Android IP Webcam (LAN Template)',
    snapshotUrl: 'http://192.168.1.100:8080/shot.jpg',
    pollMs: 450,
    kind: 'http-snapshot',
  },
];

export async function getSavedWifiCameras(): Promise<WifiCameraSource[]> {
  const db = await getDb();
  const row = await db.get('meta', 'wifi_cameras');
  if (row && Array.isArray(row.value) && row.value.length > 0) {
    return row.value as WifiCameraSource[];
  }
  return DEFAULT_WIFI_CAMERAS;
}

export async function saveWifiCameras(cams: WifiCameraSource[]): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: 'wifi_cameras', value: cams });
}

export async function imageUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function seedSampleDocumentsIfEmpty(): Promise<ScanDocument[]> {
  const existing = await getAllDocuments();
  if (existing.length > 0) return existing;

  const db = await getDb();
  const seededFlag = await db.get('meta', 'seeded_v1');
  if (seededFlag) return existing;

  const samples: Array<{
    title: string;
    fileName: string;
    category: DocumentCategory;
    url: string;
    ocrText: string;
    lang: 'eng' | 'eng+hin';
  }> = [
    {
      title: 'Commercial Invoice #2026-0842',
      fileName: 'Invoice_2026-0842.jpg',
      category: 'Receipts',
      url: '/src/assets/images/sample_invoice_doc_1795454311066.jpg',
      ocrText:
        'INVOICE #2026-0842\nGlobalTech Solutions Ltd.\n123 Innovation Drive, London\nSubtotal: £4,520.00 | VAT (20%): £904.00 | Total Due: £5,424.00',
      lang: 'eng',
    },
    {
      title: 'Office Circular Notice (EN/HI)',
      fileName: 'Circular_Office_Hours_HI_EN.jpg',
      category: 'Certificates',
      url: '/src/assets/images/sample_hindi_notice_1795454310304.jpg',
      ocrText:
        'GOVERNMENT OF INDIA / भारत सरकार\nCIRCULAR: MODIFICATION OF OFFICE WORKING HOURS\nपरिपत्र: कार्यालय के कामकाज के समय में परिवर्तन\nWorking hours revised to 9:30 AM to 6:00 PM (Monday to Friday).',
      lang: 'eng+hin',
    },
    {
      title: 'Employee Access Card — Aarav Sharma',
      fileName: 'ID_EMP_4092_Front.jpg',
      category: 'ID_Cards',
      url: '/src/assets/images/sample_id_card_1795454310924.jpg',
      ocrText: 'TECH SOLUTIONS INC.\nAARAV SHARMA\nEmployee ID: EMP-4092\nDepartment: Engineering\nCard Valid: 2024-2027',
      lang: 'eng',
    },
  ];

  const created: ScanDocument[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    try {
      const dataUrl = await imageUrlToDataUrl(s.url);
      const sha256 = await computeSha256(dataUrl);
      const timestamp = new Date(Date.now() - (i + 1) * 3600 * 1000).toISOString();
      const doc: ScanDocument = {
        id: crypto.randomUUID(),
        title: s.title,
        fileName: s.fileName,
        category: s.category,
        folder: `Documents/${s.category}`,
        mimeType: 'image/jpeg',
        fileExtension: 'jpg',
        sizeBytes: Math.round((dataUrl.length * 3) / 4),
        pageCount: 1,
        dataUrl,
        thumbnailUrl: dataUrl,
        ocrText: s.ocrText,
        ocrLanguage: s.lang,
        ocrStatus: 'done',
        filterMode: 'original',
        sourceDevice: 'Sample Library',
        sha256,
        version: 1,
        syncStatus: 'local',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await saveDocument(doc);
      created.push(doc);
    } catch {
      // Ignore sample load error
    }
  }

  await db.put('meta', { key: 'seeded_v1', value: true });
  return created;
}
