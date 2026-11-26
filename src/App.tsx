import { Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { BrandLogo } from './components/BrandLogo';
import { DesktopWorkbench } from './components/DesktopWorkbench';
import { DocumentPagesModal } from './components/DocumentPagesModal';
import { DocumentPreviewModal } from './components/DocumentPreviewModal';
import { DownloadFormatModal } from './components/DownloadFormatModal';
import { ImageEditorModal, type EditorStudioTab } from './components/ImageEditorModal';
import { LoginPanel } from './components/LoginPanel';
import { MobileCompanion } from './components/MobileCompanion';
import { OcrWorkspaceModal } from './components/OcrWorkspaceModal';
import { ShareModal } from './components/ShareModal';
import { runOcrExtraction } from './services/ocrService';
import {
  computeSha256,
  DEFAULT_SETTINGS,
  deleteDocument as dbDeleteDocument,
  deleteTransfer as dbDeleteTransfer,
  formatFileNameFromTemplate,
  getAllDocuments,
  getAllTransfers,
  getCustomFolders,
  getDeviceId,
  getFolderPrefs,
  getSavedPairCode,
  getSavedPcAddresses,
  getSelectedPcAddressId,
  getSettings,
  hashPin,
  saveCustomFolders,
  saveDocument as dbSaveDocument,
  saveFolderPrefs,
  savePairCode,
  savePcAddresses,
  saveSelectedPcAddressId,
  saveSettings as dbSaveSettings,
  saveTransfer as dbSaveTransfer,
  seedSampleDocumentsIfEmpty,
} from './services/db';
import {
  removeSavedPcAddress,
  upsertSavedPcAddress,
  type SavedPcAddress,
} from './services/pcAddressMath';
import {
  createFolderInPrefs,
  deleteFolderFromPrefs,
  EMPTY_FOLDER_PREFS,
  renameFolderInPrefs,
  type FolderPrefs,
} from './services/folderMath';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import {
  clearDriveAccessToken,
  getDriveAccessToken,
  signOutFirebase,
  subscribeFirebaseAuth,
} from './firebase';
import {
  ensureScannerDriveFolder,
  syncPendingDocumentsToGoogleDrive,
  uploadDocumentToDrive,
  upsertDocumentToDrive,
} from './services/googleDriveService';
import {
  apiCloudFetchDocuments,
  apiCloudUploadDocument,
  apiFirebaseAuth,
  apiLogout,
  apiRestoreSession,
  createPairingChannel,
  removePairedDevice,
  ScannerSyncSocket,
  verifyPairingCode,
} from './services/syncClient';
import type {
  ActivityNotification,
  DocumentCategory,
  DocumentFilterMode,
  OcrLanguage,
  PairedDevice,
  ScanDocument,
  ScannerSettings,
  TransferJob,
  UserAccount,
  WorkspaceMode,
} from './types';

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialMode: WorkspaceMode =
    urlParams.get('mode') === 'mobile' || window.innerWidth < 768 ? 'mobile' : 'desktop';
  const initialUrlPair = urlParams.get('pair') || '';

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialMode);
  const [ready, setReady] = useState(false);

  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [folderPrefs, setFolderPrefs] = useState<FolderPrefs>(EMPTY_FOLDER_PREFS);
  const [deviceId, setDeviceId] = useState('');
  const [mobileDeviceName, setMobileDeviceName] = useState('Android / Mobile Companion');

  // Pairing & WebSocket State
  const [pairCode, setPairCode] = useState(initialUrlPair);
  const [savedPcAddresses, setSavedPcAddresses] = useState<SavedPcAddress[]>([]);
  const [selectedPcId, setSelectedPcId] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [desktopOnline, setDesktopOnline] = useState(true);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const socketRef = useRef<ScannerSyncSocket | null>(null);

  const selectedPcOrigin = useMemo(
    () =>
      savedPcAddresses.find((p) => p.id === selectedPcId)?.address ||
      savedPcAddresses[0]?.address ||
      '',
    [savedPcAddresses, selectedPcId]
  );

  // Network & Offline State
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const isOffline = !browserOnline || settings.offlineModeSimulated;

  // Auth & Cloud State (Bearer & Drive tokens held strictly in memory)
  const [user, setUser] = useState<UserAccount | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [driveToken, setDriveToken] = useState(() => getDriveAccessToken() || '');
  const authTokenRef = useRef('');
  authTokenRef.current = authToken;
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [showLoginPanel, setShowLoginPanel] = useState(false);

  // App Lock State
  const [locked, setLocked] = useState(false);
  const [pinAttempt, setPinAttempt] = useState('');
  const [pinError, setPinError] = useState('');

  // Activity Notifications & Batch OCR
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [batchOcrRunning, setBatchOcrRunning] = useState(false);

  // Active Modals
  const [previewDoc, setPreviewDoc] = useState<ScanDocument | null>(null);
  const [docPagesTargetId, setDocPagesTargetId] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<ScanDocument | null>(null);
  const [editorInitialTab, setEditorInitialTab] = useState<EditorStudioTab>('clean');
  const [ocrDoc, setOcrDoc] = useState<ScanDocument | null>(null);
  const [shareDoc, setShareDoc] = useState<ScanDocument | null>(null);
  const [downloadDoc, setDownloadDoc] = useState<ScanDocument | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const docPagesTarget = useMemo(
    () => (docPagesTargetId ? documents.find((d) => d.id === docPagesTargetId) || null : null),
    [docPagesTargetId, documents]
  );

  const handleOpenEditor = useCallback((doc: ScanDocument, tab: EditorStudioTab = 'clean') => {
    setEditorInitialTab(tab);
    setEditingDoc(doc);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? '' : curr));
    }, 3200);
  }, []);

  const pushNotification = useCallback(
    (title: string, detail: string, category: ActivityNotification['category'] = 'system') => {
      const entry: ActivityNotification = {
        id: crypto.randomUUID(),
        title,
        detail,
        category,
        timestamp: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [entry, ...prev].slice(0, 80));
    },
    []
  );

  const handleMarkNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, []);

  // Online / Offline listeners
  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Boot offline-first IndexedDB state
  useEffect(() => {
    let active = true;
    (async () => {
      const [
        loadedSettings,
        loadedFolders,
        loadedFolderPrefs,
        loadedTransfers,
        id,
        savedCode,
        loadedPcs,
        loadedSelectedPcId,
      ] = await Promise.all([
        getSettings(),
        getCustomFolders(),
        getFolderPrefs(),
        getAllTransfers(),
        getDeviceId(),
        getSavedPairCode(),
        getSavedPcAddresses(),
        getSelectedPcAddressId(),
      ]);

      await seedSampleDocumentsIfEmpty();
      const loadedDocs = await getAllDocuments();

      if (!active) return;
      setSettings(loadedSettings);
      setCustomFolders(loadedFolders);
      setFolderPrefs(loadedFolderPrefs);
      setTransfers(loadedTransfers);
      setDocuments(loadedDocs);
      setDeviceId(id);

      let nextPcs = loadedPcs;
      let nextSelectedPcId = loadedSelectedPcId;

      if (initialUrlPair) {
        const upserted = upsertSavedPcAddress(loadedPcs, {
          address: window.location.origin,
          pairCode: initialUrlPair,
        });
        nextPcs = upserted.nextList;
        if (upserted.savedEntry) {
          nextSelectedPcId = upserted.savedEntry.id;
          await savePcAddresses(nextPcs);
          await saveSelectedPcAddressId(nextSelectedPcId);
        }
      }

      setSavedPcAddresses(nextPcs);
      setSelectedPcId(nextSelectedPcId || nextPcs[0]?.id || '');

      if (loadedSettings.appLockPinHash) {
        setLocked(true);
      }

      if (initialUrlPair) {
        setPairCode(initialUrlPair);
        await savePairCode(initialUrlPair);
      } else if (savedCode) {
        setPairCode(savedCode);
      }

      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [initialUrlPair]);

  // Auto-restore signed-in session (Server HttpOnly cookie + Firebase Google/Social Auth)
  useEffect(() => {
    if (!ready || isOffline) return;
    let active = true;

    apiRestoreSession()
      .then((restored) => {
        if (!active || !restored || authTokenRef.current) return;
        setAuthToken(restored.token);
        setUser(restored.user);
      })
      .catch(() => {
        // Offline or no active cookie session
      });

    const unsubscribe = subscribeFirebaseAuth(async (fbUser) => {
      if (!active || !fbUser || authTokenRef.current) return;
      try {
        const idToken = await fbUser.getIdToken();
        const res = await apiFirebaseAuth(idToken);
        if (!active || authTokenRef.current) return;
        setAuthToken(res.token);
        setUser(res.user);
      } catch {
        // Ignore transient network errors during silent restore
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [ready, isOffline]);

  // Auto-sync unsynced local scans to Google Drive ("Oklivo Scanner" folder) once per connected Drive OAuth session
  const lastSyncedDriveTokenRef = useRef('');
  useEffect(() => {
    if (!ready || !driveToken || !(settings.autoDriveBackup ?? true) || isOffline) return;
    if (lastSyncedDriveTokenRef.current === driveToken) return;
    lastSyncedDriveTokenRef.current = driveToken;

    const unsyncedDocs = documents.filter((d) => d.syncStatus !== 'synced');
    if (unsyncedDocs.length === 0) return;

    syncPendingDocumentsToGoogleDrive(driveToken, unsyncedDocs)
      .then(async (syncedIds) => {
        if (syncedIds.length === 0) return;
        const idSet = new Set(syncedIds);
        const syncedList: ScanDocument[] = [];
        setDocuments((prev) =>
          prev.map((d) => {
            if (!idSet.has(d.id)) return d;
            const next = { ...d, syncStatus: 'synced' } as ScanDocument;
            syncedList.push(next);
            return next;
          })
        );
        for (const doc of syncedList) {
          await dbSaveDocument(doc);
        }
        pushNotification(
          'Google Drive Auto-Saved',
          `Saved ${syncedIds.length} document(s) to Google Drive folder "Oklivo Scanner".`,
          'cloud'
        );
        showToast(`Saved ${syncedIds.length} document(s) to Google Drive`);
      })
      .catch((err) => {
        lastSyncedDriveTokenRef.current = '';
        const msg = err instanceof Error ? err.message : '';
        if (msg.toLowerCase().includes('expired')) {
          clearDriveAccessToken();
          setDriveToken('');
          showToast('Google Drive session expired — reconnect Drive to auto-save.');
        }
      });
  }, [ready, driveToken, settings.autoDriveBackup, isOffline, documents, pushNotification, showToast]);

  // Ensure Desktop has an active pairing code once ready
  useEffect(() => {
    if (!ready || isOffline) return;
    if (workspaceMode === 'desktop') {
      createPairingChannel(pairCode || undefined)
        .then(async (session) => {
          setPairCode(session.pairCode);
          setDevices(session.devices || []);
          await savePairCode(session.pairCode);
        })
        .catch(() => {
          // Offline or server unavailable; keep working locally
        });
    }
  }, [ready, workspaceMode, isOffline, pairCode]);

  // Flush queued transfers whenever WebSocket is connected and not offline
  const flushTransferQueue = useCallback(
    async (sock: ScannerSyncSocket, docsSnapshot: ScanDocument[], jobsSnapshot: TransferJob[]) => {
      if (isOffline || !sock) return;
      const pending = jobsSnapshot.filter((j) => j.status === 'queued' || j.status === 'failed');
      for (const job of pending) {
        const doc = docsSnapshot.find((d) => d.id === job.documentId);
        if (!doc) continue;
        const sent = sock.sendDocument(doc);
        if (sent) {
          const updated: TransferJob = { ...job, status: 'transferring', progress: 65 };
          await dbSaveTransfer(updated);
          setTransfers((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        }
      }
    },
    [isOffline]
  );

  // Connect WebSocket for real-time Mobile-to-PC pairing & transfers
  useEffect(() => {
    if (!ready || !pairCode || !deviceId || isOffline) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    const sock = new ScannerSyncSocket();
    socketRef.current = sock;

    sock.connect({
      role: workspaceMode,
      pairCode,
      deviceId,
      deviceName: workspaceMode === 'mobile' ? mobileDeviceName : 'Windows Desktop Workbench',
      serverOrigin: workspaceMode === 'mobile' ? selectedPcOrigin : '',
      handlers: {
        onStatusChange: (connected) => {
          setWsConnected(connected);
          if (connected && workspaceMode === 'mobile') {
            void flushTransferQueue(sock, documents, transfers);
          }
        },
        onPresence: (payload) => {
          setDevices(payload.devices);
          setDesktopOnline(payload.desktopOnline);
        },
        onIncomingDocument: async (incoming, fromDeviceName) => {
          setDocuments((prev) => {
            if (prev.some((d) => d.id === incoming.id || d.sha256 === incoming.sha256)) {
              return prev;
            }
            const routed: ScanDocument = {
              ...incoming,
              sourceDevice: fromDeviceName || incoming.sourceDevice,
              syncStatus: 'local',
            };
            void dbSaveDocument(routed);
            showToast(`Received "${routed.title}" from ${routed.sourceDevice}`);
            pushNotification(
              'Received Mobile Scan',
              `"${routed.title}" transferred from ${routed.sourceDevice}`,
              'transfer'
            );
            return [routed, ...prev];
          });
        },
        onTransferAck: async (documentId, ackStatus) => {
          setTransfers((prev) =>
            prev.map((job) => {
              if (job.documentId !== documentId) return job;
              const next: TransferJob = {
                ...job,
                status: 'completed',
                progress: 100,
                completedAt: new Date().toISOString(),
                error: ackStatus === 'buffered' ? 'Buffered for Desktop reconnect' : undefined,
              };
              void dbSaveTransfer(next);
              return next;
            })
          );
        },
        onError: (msg) => {
          showToast(msg);
        },
      },
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, workspaceMode, pairCode, deviceId, isOffline, mobileDeviceName, selectedPcOrigin]);

  // Save a newly scanned or generated document (instant local save + auto-transfer queue)
  const handleSaveDocument = useCallback(
    async (params: {
      dataUrl: string;
      title: string;
      category: DocumentCategory;
      mimeType: string;
      fileExtension: string;
      pageCount?: number;
      pages?: string[];
    }) => {
      const sha256 = await computeSha256(params.dataUrl);
      const existingNames = new Set(documents.map((d) => d.fileName));
      const fileName = formatFileNameFromTemplate(
        settings.namingTemplate,
        params.fileExtension,
        existingNames
      );
      const now = new Date().toISOString();
      const sizeBytes = Math.round((params.dataUrl.length * 3) / 4);

      const newDoc: ScanDocument = {
        id: crypto.randomUUID(),
        title: params.title,
        fileName,
        category: params.category,
        folder: `Documents/${params.category}`,
        mimeType: params.mimeType,
        fileExtension: params.fileExtension,
        sizeBytes,
        pageCount: params.pageCount || 1,
        dataUrl: params.dataUrl,
        thumbnailUrl: params.mimeType.startsWith('image/') ? params.dataUrl : undefined,
        pages: params.pages,
        ocrText: '',
        ocrStatus: 'idle',
        filterMode: settings.defaultFilter,
        sourceDevice: workspaceMode === 'mobile' ? mobileDeviceName : 'Windows Desktop',
        sha256,
        version: 1,
        syncStatus: 'local',
        createdAt: now,
        updatedAt: now,
      };

      await dbSaveDocument(newDoc);
      setDocuments((prev) => [newDoc, ...prev]);

      // Automatic Mobile-to-PC Transfer Queue
      if (workspaceMode === 'mobile' && settings.autoTransfer && pairCode) {
        const job: TransferJob = {
          id: crypto.randomUUID(),
          documentId: newDoc.id,
          title: newDoc.title,
          fileName: newDoc.fileName,
          sizeBytes: newDoc.sizeBytes,
          pairCode,
          targetDeviceName: 'Windows Desktop Workbench',
          status: 'queued',
          progress: 10,
          retries: 0,
          createdAt: now,
        };
        await dbSaveTransfer(job);
        setTransfers((prev) => [job, ...prev]);

        if (!isOffline && socketRef.current && wsConnected) {
          const sent = socketRef.current.sendDocument(newDoc);
          if (sent) {
            const transferringJob: TransferJob = { ...job, status: 'transferring', progress: 70 };
            await dbSaveTransfer(transferringJob);
            setTransfers((prev) => prev.map((t) => (t.id === transferringJob.id ? transferringJob : t)));
          }
        }
      }

      // Optional automatic cloud backup when authenticated & online
      if (user && authToken && settings.autoCloudBackup && !isOffline) {
        apiCloudUploadDocument(authToken, newDoc)
          .then(async () => {
            const syncedDoc: ScanDocument = { ...newDoc, syncStatus: 'synced' };
            await dbSaveDocument(syncedDoc);
            setDocuments((prev) => prev.map((d) => (d.id === syncedDoc.id ? syncedDoc : d)));
          })
          .catch(() => {
            // Keep local if cloud backup fails transiently
          });
      }

      // Automatic Google Drive upload when connected & online
      if (driveToken && (settings.autoDriveBackup ?? true) && !isOffline) {
        ensureScannerDriveFolder(driveToken)
          .then((folderId) => uploadDocumentToDrive(driveToken, folderId, newDoc))
          .then(async () => {
            const syncedDoc: ScanDocument = { ...newDoc, syncStatus: 'synced' };
            await dbSaveDocument(syncedDoc);
            setDocuments((prev) => prev.map((d) => (d.id === syncedDoc.id ? syncedDoc : d)));
            showToast(`Saved "${newDoc.title}" to Google Drive`);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : '';
            if (msg.toLowerCase().includes('expired')) {
              clearDriveAccessToken();
              setDriveToken('');
              showToast('Google Drive session expired — reconnect Drive to auto-save.');
            }
          });
      }

      // Optional non-blocking background Auto-OCR for scanned images
      if (settings.autoOcrOnCapture && params.mimeType.startsWith('image/')) {
        const lang = settings.ocrDefaultLang;
        runOcrExtraction(params.dataUrl, lang)
          .then(async (res) => {
            const ocrUpdated: ScanDocument = {
              ...newDoc,
              ocrText: res.text,
              ocrLanguage: lang,
              ocrStatus: 'done',
              updatedAt: new Date().toISOString(),
            };
            await dbSaveDocument(ocrUpdated);
            setDocuments((prev) => prev.map((d) => (d.id === ocrUpdated.id ? ocrUpdated : d)));
            pushNotification(
              'Auto-OCR Completed',
              `Extracted text from "${newDoc.title}" (${res.confidence.toFixed(0)}% confidence)`,
              'ocr'
            );
          })
          .catch(() => {
            // Keep idle if OCR fails silently in background
          });
      }
    },
    [
      authToken,
      documents,
      driveToken,
      isOffline,
      mobileDeviceName,
      pairCode,
      pushNotification,
      settings.autoCloudBackup,
      settings.autoDriveBackup,
      settings.autoOcrOnCapture,
      settings.autoTransfer,
      settings.defaultFilter,
      settings.namingTemplate,
      settings.ocrDefaultLang,
      user,
      workspaceMode,
      wsConnected,
    ]
  );

  const handleUpdateDocument = useCallback(
    async (updated: ScanDocument) => {
      const next: ScanDocument = {
        ...updated,
        version: updated.version + 1,
        updatedAt: new Date().toISOString(),
      };
      await dbSaveDocument(next);
      setDocuments((prev) => prev.map((d) => (d.id === next.id ? next : d)));

      if (driveToken && (settings.autoDriveBackup ?? true) && !isOffline) {
        upsertDocumentToDrive(driveToken, next)
          .then(async () => {
            const synced: ScanDocument = { ...next, syncStatus: 'synced' };
            await dbSaveDocument(synced);
            setDocuments((prev) => prev.map((d) => (d.id === synced.id ? synced : d)));
          })
          .catch(() => {
            // Keep local if Drive update fails transiently
          });
      }
    },
    [driveToken, isOffline, settings.autoDriveBackup]
  );

  const handleDeleteDocument = useCallback(async (id: string) => {
    await dbDeleteDocument(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleUpdateSettings = useCallback(async (next: ScannerSettings) => {
    setSettings(next);
    await dbSaveSettings(next);
  }, []);

  const handleAddCustomFolder = useCallback(
    async (name: string) => {
      const clean = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!clean || customFolders.includes(clean)) return;
      const next = [...customFolders, clean];
      setCustomFolders(next);
      await saveCustomFolders(next);
      const nextPrefs = createFolderInPrefs(folderPrefs, name.trim() || clean).nextPrefs;
      setFolderPrefs(nextPrefs);
      await saveFolderPrefs(nextPrefs);
    },
    [customFolders, folderPrefs]
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      const { nextPrefs } = createFolderInPrefs(folderPrefs, name);
      setFolderPrefs(nextPrefs);
      setCustomFolders(nextPrefs.customFolders);
      await saveFolderPrefs(nextPrefs);
    },
    [folderPrefs]
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      const nextPrefs = renameFolderInPrefs(folderPrefs, folderId, newName);
      setFolderPrefs(nextPrefs);
      await saveFolderPrefs(nextPrefs);
    },
    [folderPrefs]
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      const nextPrefs = deleteFolderFromPrefs(folderPrefs, folderId);
      setFolderPrefs(nextPrefs);
      setCustomFolders(nextPrefs.customFolders);
      await saveFolderPrefs(nextPrefs);

      // Reassign any docs in the deleted folder cleanly to Scans so nothing is lost
      const affected = documents.filter(
        (d) => d.category === folderId || d.folder === folderId || d.folder.endsWith(`/${folderId}`)
      );
      if (affected.length > 0) {
        const updatedList: ScanDocument[] = [];
        for (const doc of affected) {
          const updated: ScanDocument = {
            ...doc,
            category: 'Scans',
            folder: 'Documents/Scans',
            updatedAt: new Date().toISOString(),
          };
          await dbSaveDocument(updated);
          updatedList.push(updated);
        }
        setDocuments((prev) =>
          prev.map((d) => updatedList.find((u) => u.id === d.id) || d)
        );
      }
    },
    [documents, folderPrefs]
  );

  const handleRegeneratePairCode = useCallback(async () => {
    const session = await createPairingChannel(undefined);
    setPairCode(session.pairCode);
    setDevices(session.devices || []);
    await savePairCode(session.pairCode);
  }, []);

  const handleRemoveDevice = useCallback(
    async (targetDeviceId: string) => {
      if (!pairCode) return;
      const remaining = await removePairedDevice(pairCode, targetDeviceId);
      setDevices(remaining);
    },
    [pairCode]
  );

  const handleSavePcAddress = useCallback(
    async (address: string, code?: string): Promise<SavedPcAddress | null> => {
      const { nextList, savedEntry } = upsertSavedPcAddress(savedPcAddresses, {
        address,
        pairCode: code,
      });
      if (!savedEntry) return null;
      setSavedPcAddresses(nextList);
      setSelectedPcId(savedEntry.id);
      await savePcAddresses(nextList);
      await saveSelectedPcAddressId(savedEntry.id);
      return savedEntry;
    },
    [savedPcAddresses]
  );

  const handleSelectPcAddress = useCallback(async (pc: SavedPcAddress) => {
    setSelectedPcId(pc.id);
    await saveSelectedPcAddressId(pc.id);
    if (pc.pairCode) {
      setPairCode(pc.pairCode);
      await savePairCode(pc.pairCode);
    }
  }, []);

  const handleDeletePcAddress = useCallback(
    async (id: string) => {
      const nextList = removeSavedPcAddress(savedPcAddresses, id);
      setSavedPcAddresses(nextList);
      await savePcAddresses(nextList);
      if (selectedPcId === id) {
        const nextId = nextList[0]?.id || '';
        setSelectedPcId(nextId);
        await saveSelectedPcAddressId(nextId);
      }
    },
    [savedPcAddresses, selectedPcId]
  );

  const handlePairMobileWithCode = useCallback(
    async (code: string, pcAddress?: string): Promise<boolean> => {
      const targetOrigin = pcAddress || selectedPcOrigin || window.location.origin;
      await handleSavePcAddress(targetOrigin, code);
      try {
        const valid = await verifyPairingCode(code, targetOrigin);
        if (!valid) return false;
        setPairCode(code);
        await savePairCode(code);
        return true;
      } catch {
        return false;
      }
    },
    [handleSavePcAddress, selectedPcOrigin]
  );

  const handleDisconnectPc = useCallback(async () => {
    socketRef.current?.disconnect();
    setPairCode('');
    setWsConnected(false);
    await savePairCode('');
  }, []);

  const handleRetryTransfer = useCallback(
    async (job: TransferJob) => {
      const doc = documents.find((d) => d.id === job.documentId);
      if (!doc) return;
      const updated: TransferJob = { ...job, status: 'queued', retries: job.retries + 1, progress: 25 };
      await dbSaveTransfer(updated);
      setTransfers((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (!isOffline && socketRef.current && wsConnected) {
        const sent = socketRef.current.sendDocument(doc);
        if (sent) {
          const tx: TransferJob = { ...updated, status: 'transferring', progress: 70 };
          await dbSaveTransfer(tx);
          setTransfers((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
        }
      }
    },
    [documents, isOffline, wsConnected]
  );

  const handleClearCompletedTransfers = useCallback(async () => {
    const completed = transfers.filter((t) => t.status === 'completed');
    for (const job of completed) {
      await dbDeleteTransfer(job.id);
    }
    setTransfers((prev) => prev.filter((t) => t.status !== 'completed'));
  }, [transfers]);

  const handleCloudSyncAll = useCallback(async () => {
    if (!authToken || isOffline) return;
    setCloudSyncing(true);
    try {
      for (const doc of documents) {
        await apiCloudUploadDocument(authToken, doc);
        const synced: ScanDocument = { ...doc, syncStatus: 'synced' };
        await dbSaveDocument(synced);
      }
      const remoteDocs = await apiCloudFetchDocuments(authToken);
      const localMap = new Map<string, ScanDocument>(
        documents.map((d) => [d.id, { ...d, syncStatus: 'synced' }])
      );
      for (const rd of remoteDocs) {
        if (!localMap.has(rd.id) && rd.dataUrl) {
          await dbSaveDocument(rd);
          localMap.set(rd.id, rd);
        }
      }
      setDocuments(Array.from(localMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      pushNotification('Cloud Backup Synced', `Synchronized ${localMap.size} documents with cloud`, 'cloud');
      showToast('Cloud backup synchronized.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cloud sync failed.');
    } finally {
      setCloudSyncing(false);
    }
  }, [authToken, documents, isOffline, pushNotification, showToast]);

  const handleSaveEditedImage = async (
    updatedDataUrl: string,
    filterMode: DocumentFilterMode,
    sizeBytes: number
  ) => {
    if (!editingDoc) return;
    const sha256 = await computeSha256(updatedDataUrl);
    await handleUpdateDocument({
      ...editingDoc,
      dataUrl: updatedDataUrl,
      thumbnailUrl: updatedDataUrl,
      filterMode,
      sizeBytes,
      sha256,
    });
    showToast(`Updated "${editingDoc.title}"`);
  };

  const handleSaveOcr = async (docId: string, text: string, lang: OcrLanguage) => {
    const target = documents.find((d) => d.id === docId);
    if (!target) return;
    await handleUpdateDocument({
      ...target,
      ocrText: text,
      ocrLanguage: lang,
      ocrStatus: 'done',
    });
  };

  const handleBatchOcr = useCallback(
    async (docIds: string[]) => {
      const targets = documents.filter(
        (d) => docIds.includes(d.id) && d.mimeType.startsWith('image/')
      );
      if (targets.length === 0) {
        showToast('Select at least one image scan for Batch OCR.');
        return;
      }
      setBatchOcrRunning(true);
      let completed = 0;
      try {
        for (const doc of targets) {
          const processingDoc: ScanDocument = { ...doc, ocrStatus: 'processing' };
          setDocuments((prev) => prev.map((d) => (d.id === doc.id ? processingDoc : d)));
          try {
            const res = await runOcrExtraction(doc.dataUrl, settings.ocrDefaultLang);
            const updated: ScanDocument = {
              ...doc,
              ocrText: res.text,
              ocrLanguage: settings.ocrDefaultLang,
              ocrStatus: 'done',
              version: doc.version + 1,
              updatedAt: new Date().toISOString(),
            };
            await dbSaveDocument(updated);
            setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
            completed += 1;
          } catch {
            const failedDoc: ScanDocument = { ...doc, ocrStatus: 'error' };
            await dbSaveDocument(failedDoc);
            setDocuments((prev) => prev.map((d) => (d.id === doc.id ? failedDoc : d)));
          }
        }
        pushNotification(
          'Batch OCR Finished',
          `Processed ${completed}/${targets.length} image scans (${settings.ocrDefaultLang})`,
          'ocr'
        );
        showToast(`Batch OCR completed for ${completed}/${targets.length} images.`);
      } finally {
        setBatchOcrRunning(false);
      }
    },
    [documents, pushNotification, settings.ocrDefaultLang, showToast]
  );

  // App Lock Screen
  if (locked && settings.appLockPinHash) {
    return (
      <div className="min-h-screen bg-emerald-950 flex items-center justify-center p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const attempted = await hashPin(pinAttempt);
            if (attempted === settings.appLockPinHash) {
              setLocked(false);
              setPinAttempt('');
              setPinError('');
            } else {
              setPinError('Incorrect PIN.');
            }
          }}
          className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-4 text-center"
        >
          <div className="flex justify-center">
            <BrandLogo size={64} />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-900">Scanner Locked</h1>
            <p className="text-xs text-slate-500 mt-1">Enter your local privacy PIN to unlock documents</p>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              inputMode="numeric"
              value={pinAttempt}
              onChange={(e) => setPinAttempt(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter PIN"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl font-mono text-center tracking-widest"
              autoFocus
            />
          </div>
          {pinError && <p className="text-xs text-red-600">{pinError}</p>}
          <button
            type="submit"
            className="w-full py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold rounded-xl"
          >
            Unlock Scanner
          </button>
        </form>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <BrandLogo size={72} />
        <div className="text-sm font-display font-bold text-emerald-950">
          Oklivo Scanner
        </div>
        <div className="text-xs text-slate-500">Initializing offline storage & scanner engine...</div>
      </div>
    );
  }

  if (showLoginPanel && !user) {
    return (
      <LoginPanel
        onAuthenticated={(token, acc, mode, driveTok) => {
          setAuthToken(token);
          setUser(acc);
          if (driveTok) setDriveToken(driveTok);
          if (mode) setWorkspaceMode(mode);
          setShowLoginPanel(false);
          pushNotification('Signed In', `Authenticated as ${acc.displayName} (${acc.email})`, 'cloud');
        }}
        onContinueLocal={(mode) => {
          setWorkspaceMode(mode);
          setShowLoginPanel(false);
          pushNotification('Local-Only Mode Active', 'Scanning & LAN PC transfer ready without cloud login', 'system');
        }}
      />
    );
  }

  return (
    <>
      {workspaceMode === 'desktop' ? (
        <DesktopWorkbench
          documents={documents}
          transfers={transfers}
          notifications={notifications}
          devices={devices}
          pairCode={pairCode}
          wsConnected={wsConnected}
          isOffline={isOffline}
          settings={settings}
          customFolders={customFolders}
          user={user}
          onSwitchToMobile={() => setWorkspaceMode('mobile')}
          onOpenAuth={() => setShowAuthModal(true)}
          onOpenLoginPanel={() => setShowLoginPanel(true)}
          onPreviewDoc={setPreviewDoc}
          onOpenDocPages={(d) => setDocPagesTargetId(d.id)}
          onEditDoc={handleOpenEditor}
          onOpenOcr={setOcrDoc}
          onShareDoc={setShareDoc}
          onDownloadDoc={setDownloadDoc}
          onBatchOcr={handleBatchOcr}
          batchOcrRunning={batchOcrRunning}
          onMarkNotificationsRead={handleMarkNotificationsRead}
          onSaveDocument={handleSaveDocument}
          onUpdateDocument={handleUpdateDocument}
          onDeleteDocument={handleDeleteDocument}
          onUpdateSettings={handleUpdateSettings}
          onAddCustomFolder={handleAddCustomFolder}
          onRegeneratePairCode={handleRegeneratePairCode}
          onRemoveDevice={handleRemoveDevice}
          onRetryTransfer={handleRetryTransfer}
          onClearCompletedTransfers={handleClearCompletedTransfers}
          onCloudSyncAll={handleCloudSyncAll}
          cloudSyncing={cloudSyncing}
          driveConnected={Boolean(driveToken)}
          onOpenDriveBackup={() => setShowDriveModal(true)}
        />
      ) : (
        <MobileCompanion
          documents={documents}
          transfers={transfers}
          pairCode={pairCode}
          wsConnected={wsConnected}
          desktopOnline={desktopOnline}
          isOffline={isOffline}
          deviceName={mobileDeviceName}
          settings={settings}
          user={user}
          savedPcAddresses={savedPcAddresses}
          selectedPcId={selectedPcId}
          onDeviceNameChange={setMobileDeviceName}
          onSavePcAddress={handleSavePcAddress}
          onSelectPcAddress={handleSelectPcAddress}
          onDeletePcAddress={handleDeletePcAddress}
          onPairWithCode={handlePairMobileWithCode}
          onDisconnectPc={handleDisconnectPc}
          onSwitchToDesktop={() => setWorkspaceMode('desktop')}
          onOpenAuth={() => setShowAuthModal(true)}
          onOpenLoginPanel={() => setShowLoginPanel(true)}
          onSaveDocument={handleSaveDocument}
          onDeleteDocument={handleDeleteDocument}
          onOpenDocPages={(d) => setDocPagesTargetId(d.id)}
          onPreviewDoc={setPreviewDoc}
          onEditDoc={handleOpenEditor}
          onOpenOcr={setOcrDoc}
          onShareDoc={setShareDoc}
          onDownloadDoc={setDownloadDoc}
          onUpdateSettings={handleUpdateSettings}
          onRetryTransfer={handleRetryTransfer}
          driveConnected={Boolean(driveToken)}
          onOpenDriveBackup={() => setShowDriveModal(true)}
          folderPrefs={folderPrefs}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
      )}

      {/* Modals */}
      {docPagesTarget && (
        <DocumentPagesModal
          document={docPagesTarget}
          onClose={() => setDocPagesTargetId(null)}
          onUpdateDocument={handleUpdateDocument}
          onDeleteDocument={handleDeleteDocument}
          onShareDoc={setShareDoc}
          onDownloadDoc={setDownloadDoc}
          onOpenOcr={setOcrDoc}
          onOpenPreview={setPreviewDoc}
          onOpenImageEditor={handleOpenEditor}
          onSaveNewCollage={async (params) => {
            await handleSaveDocument({
              ...params,
              category: 'Scans',
            });
            showToast(`Saved collage "${params.title}"`);
          }}
        />
      )}

      {previewDoc && (
        <DocumentPreviewModal
          document={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onOpenDocPages={(d) => setDocPagesTargetId(d.id)}
          onEditImage={(d) => handleOpenEditor(d, 'clean')}
          onOpenOcr={setOcrDoc}
          onShareDoc={setShareDoc}
          onDownloadDoc={setDownloadDoc}
        />
      )}

      {editingDoc && (
        <ImageEditorModal
          document={editingDoc}
          initialTab={editorInitialTab}
          onClose={() => setEditingDoc(null)}
          onSave={handleSaveEditedImage}
        />
      )}

      {ocrDoc && (
        <OcrWorkspaceModal
          document={ocrDoc}
          onClose={() => setOcrDoc(null)}
          onSaveOcr={handleSaveOcr}
        />
      )}

      {shareDoc && (
        <ShareModal
          document={shareDoc}
          pairCode={pairCode}
          wsConnected={wsConnected}
          isOffline={isOffline}
          onDownloadDoc={setDownloadDoc}
          onSendViaLan={
            workspaceMode === 'mobile' && socketRef.current && wsConnected
              ? (targetDoc) => {
                  socketRef.current?.sendDocument(targetDoc);
                }
              : undefined
          }
          onClose={() => setShareDoc(null)}
        />
      )}

      {downloadDoc && (
        <DownloadFormatModal
          document={downloadDoc}
          onClose={() => setDownloadDoc(null)}
          onDownloaded={(msg) => showToast(msg)}
        />
      )}

      {showAuthModal && (
        <AuthModal
          user={user}
          authToken={authToken}
          settings={settings}
          onAuthenticated={(token, acc, accessTok) => {
            setAuthToken(token);
            setUser(acc);
            if (accessTok) setDriveToken(accessTok);
            pushNotification('Signed In', `Authenticated as ${acc.displayName}`, 'cloud');
          }}
          onUserUpdated={(updated) => {
            setUser(updated);
            pushNotification(
              'Account Updated',
              updated.phone ? `Mobile number linked: ${updated.phone}` : 'Account details updated',
              'cloud'
            );
          }}
          onOpenDriveBackup={() => setShowDriveModal(true)}
          onLogout={() => {
            setAuthToken('');
            setUser(null);
            setDriveToken('');
            clearDriveAccessToken();
            void apiLogout();
            void signOutFirebase();
            pushNotification('Signed Out', 'Switched back to offline local-only storage', 'system');
          }}
          onUpdateSettings={handleUpdateSettings}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {showDriveModal && (
        <GoogleDriveModal
          driveToken={driveToken}
          documents={documents}
          settings={settings}
          customFolders={customFolders}
          isOffline={isOffline}
          onDriveTokenChange={setDriveToken}
          onAuthenticated={(token, acc) => {
            setAuthToken(token);
            setUser(acc);
          }}
          onRestoreDocuments={async (restoredDocs, restoredFolders) => {
            if (restoredFolders.length > 0) {
              const mergedFolders = Array.from(new Set([...customFolders, ...restoredFolders]));
              setCustomFolders(mergedFolders);
              await saveCustomFolders(mergedFolders);
            }
            if (restoredDocs.length > 0) {
              for (const doc of restoredDocs) {
                await dbSaveDocument(doc);
              }
              setDocuments((prev) =>
                [...restoredDocs, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              );
            }
          }}
          onUpdateSettings={handleUpdateSettings}
          onNotify={(title, detail) => pushNotification(title, detail, 'cloud')}
          onClose={() => setShowDriveModal(false)}
        />
      )}

      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-16 right-4 z-50 bg-emerald-950 text-white px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg border border-emerald-800"
        >
          {toastMsg}
        </div>
      )}
    </>
  );
}
