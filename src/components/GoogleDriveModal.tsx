import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  clearDriveAccessToken,
  connectGoogleDriveWithOAuth,
  syncFirebaseProfileToFirestore,
} from '../firebase';
import { formatBytes } from '../services/db';
import {
  deleteDriveBackupFile,
  listDriveBackupFiles,
  restoreFilesFromGoogleDrive,
  syncAllToGoogleDrive,
} from '../services/googleDriveService';
import { apiFirebaseAuth } from '../services/syncClient';
import type { DriveBackupFile, ScanDocument, ScannerSettings, UserAccount } from '../types';

interface GoogleDriveModalProps {
  driveToken: string;
  documents: ScanDocument[];
  settings: ScannerSettings;
  customFolders: string[];
  isOffline: boolean;
  onDriveTokenChange: (token: string) => void;
  onAuthenticated: (token: string, user: UserAccount) => void;
  onRestoreDocuments: (docs: ScanDocument[], folders: string[]) => Promise<void>;
  onUpdateSettings: (next: ScannerSettings) => Promise<void>;
  onNotify: (title: string, detail: string) => void;
  onClose: () => void;
}

export function GoogleDriveModal({
  driveToken,
  documents,
  settings,
  customFolders,
  isOffline,
  onDriveTokenChange,
  onAuthenticated,
  onRestoreDocuments,
  onUpdateSettings,
  onNotify,
  onClose,
}: GoogleDriveModalProps) {
  const [files, setFiles] = useState<DriveBackupFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busyAction, setBusyAction] = useState<'connect' | 'backup' | 'restore' | 'delete' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DriveBackupFile | null>(null);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingDelete) {
          setPendingDelete(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, pendingDelete]);

  const loadFiles = useCallback(
    async (token: string) => {
      if (!token || isOffline) return;
      setLoadingFiles(true);
      setError('');
      try {
        const res = await listDriveBackupFiles(token);
        setFiles(res.files);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load Google Drive files';
        if (msg.toLowerCase().includes('expired')) {
          clearDriveAccessToken();
          onDriveTokenChange('');
        }
        setError(msg);
      } finally {
        setLoadingFiles(false);
      }
    },
    [isOffline, onDriveTokenChange]
  );

  useEffect(() => {
    if (driveToken) {
      void loadFiles(driveToken);
    }
  }, [driveToken, loadFiles]);

  const handleConnect = async () => {
    if (isOffline) {
      setError('You are currently offline. Turn off Offline Mode to connect Google Drive.');
      return;
    }
    setBusyAction('connect');
    setError('');
    setStatusMsg('');
    try {
      const { idToken, firebaseUser, accessToken } = await connectGoogleDriveWithOAuth();
      onDriveTokenChange(accessToken);
      const authRes = await apiFirebaseAuth(idToken);
      await syncFirebaseProfileToFirestore(firebaseUser, 'google', authRes.user.phone);
      onAuthenticated(authRes.token, authRes.user);
      setStatusMsg('Google Drive connected! Folder "Oklivo Scanner" is ready.');
      await loadFiles(accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect Google Drive.');
    } finally {
      setBusyAction(null);
    }
  };

  const ensureConnectedToken = async (): Promise<string | null> => {
    if (driveToken) return driveToken;
    const { idToken, firebaseUser, accessToken } = await connectGoogleDriveWithOAuth();
    onDriveTokenChange(accessToken);
    const authRes = await apiFirebaseAuth(idToken);
    await syncFirebaseProfileToFirestore(firebaseUser, 'google', authRes.user.phone);
    onAuthenticated(authRes.token, authRes.user);
    return accessToken;
  };

  const handleBackupAll = async () => {
    if (isOffline) {
      setError('Offline mode is active. Connect to internet before backing up to Google Drive.');
      return;
    }
    setBusyAction('backup');
    setError('');
    setStatusMsg('');
    try {
      const token = await ensureConnectedToken();
      if (!token) return;
      const result = await syncAllToGoogleDrive({
        accessToken: token,
        documents,
        settings,
        customFolders,
      });
      setFiles(result.files);
      const msg = `Saved ${result.uploadedCount} document(s) and app settings manifest to Google Drive folder "Oklivo Scanner".`;
      setStatusMsg(msg);
      onNotify('Google Drive Backup Complete', msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Drive backup failed.';
      if (msg.toLowerCase().includes('expired')) {
        clearDriveAccessToken();
        onDriveTokenChange('');
      }
      setError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestore = async () => {
    if (isOffline) {
      setError('Offline mode is active.');
      return;
    }
    setBusyAction('restore');
    setError('');
    setStatusMsg('');
    try {
      const token = await ensureConnectedToken();
      if (!token) return;
      const { restoredDocs, restoredFolders } = await restoreFilesFromGoogleDrive(token, documents);
      await onRestoreDocuments(restoredDocs, restoredFolders);
      const msg =
        restoredDocs.length > 0
          ? `Restored ${restoredDocs.length} scan(s) from Google Drive into local library.`
          : 'All Google Drive backups are already present locally.';
      setStatusMsg(msg);
      onNotify('Google Drive Restore', msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore from Google Drive.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !driveToken) return;
    setBusyAction('delete');
    setError('');
    try {
      await deleteDriveBackupFile(driveToken, pendingDelete.id);
      setFiles((prev) => prev.filter((f) => f.id !== pendingDelete.id));
      setStatusMsg(`Deleted "${pendingDelete.name}" from Google Drive.`);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete file from Google Drive.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive Backup and Sync"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pendingDelete) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-emerald-950 text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-800 flex items-center justify-center shrink-0">
              <HardDrive className="w-4.5 h-4.5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-display font-bold truncate">
                Google Drive Backup & Sync
              </div>
              <div className="text-[11px] text-emerald-300 truncate">
                Folder: Oklivo Scanner · {documents.length} local file(s)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white rounded-lg hover:bg-emerald-900"
            aria-label="Close Google Drive dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Connection Status & Official Google Sign-In Button */}
          {!driveToken ? (
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  Connect Your Google Drive
                </div>
                <p className="text-xs text-slate-600 max-w-md">
                  Approve Google Drive access so the scanner can create the &ldquo;Oklivo Scanner&rdquo; folder and upload your scans, PDFs, OCR text, and settings.
                </p>
              </div>
              <button
                type="button"
                disabled={busyAction !== null || isOffline}
                onClick={handleConnect}
                className="inline-flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 shadow-sm shrink-0 disabled:opacity-50"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{busyAction === 'connect' ? 'Connecting...' : 'Sign in with Google'}</span>
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-emerald-950 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Google Drive Connected (App Folder Access Active)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  clearDriveAccessToken();
                  onDriveTokenChange('');
                  setFiles([]);
                }}
                className="text-xs font-medium text-emerald-900 hover:underline"
              >
                Disconnect Drive Token
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busyAction !== null || isOffline}
              onClick={handleBackupAll}
              className="inline-flex items-center justify-center gap-2 py-3 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              <CloudUpload className="w-4 h-4" />
              {busyAction === 'backup'
                ? 'Uploading to Google Drive...'
                : `Save All (${documents.length}) to Google Drive`}
            </button>
            <button
              type="button"
              disabled={busyAction !== null || isOffline}
              onClick={handleRestore}
              className="inline-flex items-center justify-center gap-2 py-3 px-4 border border-slate-200 hover:border-emerald-700 bg-white hover:bg-emerald-50/40 text-slate-800 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-emerald-700" />
              {busyAction === 'restore' ? 'Restoring...' : 'Restore Missing Scans from Drive'}
            </button>
          </div>

          {/* Auto-Backup Toggle */}
          <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 text-xs">
            <div>
              <div className="font-semibold text-slate-900">Auto-Save New Scans to Google Drive</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Automatically upload newly scanned or imported files while Google Drive is connected
              </div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(settings.autoDriveBackup)}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoDriveBackup: e.target.checked })
              }
              className="accent-emerald-700 w-4 h-4 shrink-0"
            />
          </label>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {statusMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {/* Drive Folder File List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <FolderOpen className="w-4 h-4 text-emerald-700" />
                Files in Google Drive (&ldquo;Oklivo Scanner&rdquo;)
              </div>
              {driveToken && (
                <button
                  type="button"
                  disabled={loadingFiles}
                  onClick={() => loadFiles(driveToken)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              )}
            </div>

            {!driveToken ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                Connect Google Drive above to view backed-up files.
              </div>
            ) : loadingFiles ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-slate-200 rounded-xl">
                Loading files from Google Drive...
              </div>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                No backup files in Google Drive folder yet. Click &ldquo;Save All to Google Drive&rdquo; above.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {files.map((f) => (
                  <div key={f.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{f.name}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatBytes(f.sizeBytes)} · {new Date(f.modifiedTime).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {f.webViewLink && (
                        <a
                          href={f.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 text-slate-600 hover:text-emerald-800 rounded-lg hover:bg-slate-100"
                          title="Open in Google Drive"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingDelete(f)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete from Google Drive"
                        aria-label={`Delete ${f.name} from Google Drive`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Explicit Confirmation Dialog Before Deleting Any Drive File */}
        {pendingDelete && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm Google Drive File Deletion"
          >
            <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Delete file from Google Drive?</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    &ldquo;{pendingDelete.name}&rdquo; will be permanently deleted from your Google Drive folder. Your local scan copy stays intact.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busyAction === 'delete'}
                  onClick={() => setPendingDelete(null)}
                  className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyAction === 'delete'}
                  onClick={handleConfirmDelete}
                  className="px-3.5 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50"
                >
                  {busyAction === 'delete' ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
