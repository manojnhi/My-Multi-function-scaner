import type {
  DocumentCategory,
  DriveBackupFile,
  ScanDocument,
  ScannerSettings,
} from '../types';
import { computeSha256 } from './db';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const SCANNER_FOLDER_NAME = 'My Multi Functional Scanner';
const MANIFEST_FILE_NAME = 'scanner_backup_manifest.json';

function driveHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

async function dataUrlToBlob(dataUrl: string, fallbackMime: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (blob.type) return blob;
  return new Blob([blob], { type: fallbackMime || 'application/octet-stream' });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to decode Drive file'));
    reader.readAsDataURL(blob);
  });
}

export async function ensureScannerDriveFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    `name = '${SCANNER_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await fetch(
    `${DRIVE_FILES_API}?q=${query}&fields=files(id,name)&spaces=drive`,
    { headers: driveHeaders(accessToken) }
  );
  if (searchRes.status === 401) {
    throw new Error('Google Drive session expired. Please reconnect Google Drive.');
  }
  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Google Drive folder lookup failed: ${errText.slice(0, 140)}`);
  }
  const searchData = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await fetch(DRIVE_FILES_API, {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: SCANNER_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Automatic backup folder for My Multi Functional Scanner documents & PDFs.',
    }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Could not create Google Drive folder: ${errText.slice(0, 140)}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

async function multipartUpload(
  accessToken: string,
  metadata: Record<string, unknown>,
  contentBlob: Blob,
  existingFileId?: string
): Promise<DriveBackupFile> {
  const boundary = `scanner_drive_${crypto.randomUUID().replace(/-/g, '')}`;
  const metaPart = JSON.stringify(metadata);
  const headerText =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metaPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentBlob.type || 'application/octet-stream'}\r\n\r\n`;
  const footerText = `\r\n--${boundary}--`;

  const bodyBlob = new Blob([headerText, contentBlob, footerText]);
  const url = existingFileId
    ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,appProperties`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,appProperties`;

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: driveHeaders(accessToken, {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    }),
    body: bodyBlob,
  });
  if (res.status === 401) {
    throw new Error('Google Drive authorization expired. Please reconnect Google Drive.');
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive upload failed: ${errText.slice(0, 140)}`);
  }
  const f = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime: string;
    webViewLink?: string;
    appProperties?: Record<string, string>;
  };
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: Number(f.size || contentBlob.size),
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    scannerDocId: f.appProperties?.scannerDocId,
    category: f.appProperties?.category,
  };
}

export async function listDriveBackupFiles(
  accessToken: string,
  folderId?: string
): Promise<{ folderId: string; files: DriveBackupFile[] }> {
  const targetFolderId = folderId || (await ensureScannerDriveFolder(accessToken));
  const query = encodeURIComponent(`'${targetFolderId}' in parents and trashed = false`);
  const res = await fetch(
    `${DRIVE_FILES_API}?q=${query}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,appProperties)`,
    { headers: driveHeaders(accessToken) }
  );
  if (res.status === 401) {
    throw new Error('Google Drive authorization expired. Please reconnect Google Drive.');
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Could not list Google Drive files: ${errText.slice(0, 140)}`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime: string;
      webViewLink?: string;
      appProperties?: Record<string, string>;
    }>;
  };
  const files: DriveBackupFile[] = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: Number(f.size || 0),
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    scannerDocId: f.appProperties?.scannerDocId,
    category: f.appProperties?.category,
  }));
  return { folderId: targetFolderId, files };
}

export async function uploadDocumentToDrive(
  accessToken: string,
  folderId: string,
  doc: ScanDocument,
  existingDriveFileId?: string
): Promise<DriveBackupFile> {
  const blob = await dataUrlToBlob(doc.dataUrl, doc.mimeType);
  const metadata: Record<string, unknown> = {
    name: doc.fileName,
    description: `${doc.title} (${doc.category}) · My Multi Functional Scanner`,
    appProperties: {
      scannerDocId: doc.id,
      category: doc.category,
      sha256: doc.sha256.slice(0, 64),
    },
  };
  if (!existingDriveFileId) {
    metadata.parents = [folderId];
  }
  return multipartUpload(accessToken, metadata, blob, existingDriveFileId);
}

export async function syncAllToGoogleDrive(params: {
  accessToken: string;
  documents: ScanDocument[];
  settings: ScannerSettings;
  customFolders: string[];
}): Promise<{ folderId: string; uploadedCount: number; files: DriveBackupFile[] }> {
  const { accessToken, documents, settings, customFolders } = params;
  const { folderId, files: existingFiles } = await listDriveBackupFiles(accessToken);

  const byScannerId = new Map<string, DriveBackupFile>();
  let manifestFile: DriveBackupFile | undefined;
  for (const f of existingFiles) {
    if (f.scannerDocId) byScannerId.set(f.scannerDocId, f);
    if (f.name === MANIFEST_FILE_NAME) manifestFile = f;
  }

  let uploadedCount = 0;
  for (const doc of documents) {
    const existing = byScannerId.get(doc.id);
    await uploadDocumentToDrive(accessToken, folderId, doc, existing?.id);
    uploadedCount += 1;
  }

  // Upload complete metadata manifest (settings, folders, OCR text)
  const manifestPayload = {
    app: 'My Multi Functional Scanner',
    exportedAt: new Date().toISOString(),
    customFolders,
    settings: { ...settings, appLockPinHash: undefined },
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      category: d.category,
      folder: d.folder,
      mimeType: d.mimeType,
      fileExtension: d.fileExtension,
      pageCount: d.pageCount,
      ocrText: d.ocrText,
      ocrLanguage: d.ocrLanguage,
      sourceDevice: d.sourceDevice,
      sha256: d.sha256,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  };
  const manifestBlob = new Blob([JSON.stringify(manifestPayload, null, 2)], {
    type: 'application/json',
  });
  const manifestMeta: Record<string, unknown> = {
    name: MANIFEST_FILE_NAME,
    description: 'Scanner settings, folder structure, and OCR metadata manifest',
    appProperties: { kind: 'scanner_manifest' },
  };
  if (!manifestFile) {
    manifestMeta.parents = [folderId];
  }
  await multipartUpload(accessToken, manifestMeta, manifestBlob, manifestFile?.id);

  const refreshed = await listDriveBackupFiles(accessToken, folderId);
  return { folderId, uploadedCount, files: refreshed.files };
}

export async function restoreFilesFromGoogleDrive(
  accessToken: string,
  existingDocs: ScanDocument[]
): Promise<{ restoredDocs: ScanDocument[]; restoredFolders: string[] }> {
  const { files } = await listDriveBackupFiles(accessToken);
  const existingIds = new Set(existingDocs.map((d) => d.id));

  let manifestDocs: Array<Record<string, unknown>> = [];
  let restoredFolders: string[] = [];

  const manifestEntry = files.find((f) => f.name === MANIFEST_FILE_NAME);
  if (manifestEntry) {
    try {
      const mRes = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(manifestEntry.id)}?alt=media`, {
        headers: driveHeaders(accessToken),
      });
      if (mRes.ok) {
        const mJson = (await mRes.json()) as {
          customFolders?: string[];
          documents?: Array<Record<string, unknown>>;
        };
        if (Array.isArray(mJson.customFolders)) {
          restoredFolders = mJson.customFolders.filter((x) => typeof x === 'string');
        }
        if (Array.isArray(mJson.documents)) {
          manifestDocs = mJson.documents;
        }
      }
    } catch {
      // Proceed restoring binary files even if manifest read fails
    }
  }

  const restoredDocs: ScanDocument[] = [];
  for (const f of files) {
    if (f.name === MANIFEST_FILE_NAME) continue;
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    const candidateId = f.scannerDocId || `drive_${f.id}`;
    if (existingIds.has(candidateId)) continue;

    const dlRes = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(f.id)}?alt=media`, {
      headers: driveHeaders(accessToken),
    });
    if (!dlRes.ok) continue;
    const blob = await dlRes.blob();
    const dataUrl = await blobToDataUrl(blob);
    const sha256 = await computeSha256(dataUrl);
    const matchedMeta = manifestDocs.find((m) => m.id === candidateId || m.fileName === f.name);
    const ext = f.name.includes('.') ? f.name.split('.').pop() || 'jpg' : 'jpg';
    const category = ((matchedMeta?.category as DocumentCategory) ||
      (f.category as DocumentCategory) ||
      'Imported') as DocumentCategory;

    restoredDocs.push({
      id: candidateId,
      title: String(matchedMeta?.title || f.name.replace(/\.[^.]+$/, '')),
      fileName: f.name,
      category,
      folder: String(matchedMeta?.folder || `Documents/${category}`),
      mimeType: f.mimeType || blob.type || 'application/octet-stream',
      fileExtension: ext,
      sizeBytes: blob.size || f.sizeBytes,
      pageCount: Number(matchedMeta?.pageCount || 1),
      dataUrl,
      thumbnailUrl: f.mimeType.startsWith('image/') ? dataUrl : undefined,
      ocrText: String(matchedMeta?.ocrText || ''),
      ocrStatus: matchedMeta?.ocrText ? 'done' : 'idle',
      filterMode: 'original',
      sourceDevice: 'Google Drive Backup',
      sha256,
      version: 1,
      syncStatus: 'synced',
      createdAt: String(matchedMeta?.createdAt || f.modifiedTime || new Date().toISOString()),
      updatedAt: f.modifiedTime || new Date().toISOString(),
    });
  }

  return { restoredDocs, restoredFolders };
}

export async function deleteDriveBackupFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: driveHeaders(accessToken),
  });
  if (res.status === 401) {
    throw new Error('Google Drive authorization expired. Please reconnect Google Drive.');
  }
  if (!res.ok && res.status !== 204) {
    const errText = await res.text();
    throw new Error(`Could not delete Google Drive file: ${errText.slice(0, 140)}`);
  }
}
