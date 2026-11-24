import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  CreditCard,
  FilePlus2,
  FlipHorizontal2,
  FolderOpen,
  Grid3X3,
  Layers,
  Plus,
  RotateCcw,
  ScanLine,
  Timer,
  Trash2,
  Upload,
  Wifi,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSavedWifiCameras, saveWifiCameras } from '../services/db';
import {
  analyzeFrameStability,
  DEFAULT_ADJUSTMENTS,
  processImage,
} from '../services/imageProcessor';
import { idCardToSinglePdf, imagesToPdf } from '../services/pdfService';
import { getWifiCameraProxyUrl } from '../services/syncClient';
import type { DocumentCategory, ScannerSettings, WifiCameraSource } from '../types';

export type CaptureMode = 'quick' | 'auto' | 'document' | 'image' | 'id-card' | 'batch';

interface ScannerCameraStudioProps {
  mode: CaptureMode;
  settings: ScannerSettings;
  onModeChange: (mode: CaptureMode) => void;
  onQuickCaptureSave: (params: {
    dataUrl: string;
    title: string;
    category: DocumentCategory;
    mimeType: string;
    fileExtension: string;
    pageCount?: number;
    pages?: string[];
  }) => Promise<void>;
  onClose?: () => void;
}

const SAMPLE_SCENES = [
  {
    id: 'invoice',
    label: 'A4 Invoice (Angled)',
    src: '/src/assets/images/sample_invoice_doc_1795454311066.jpg',
    category: 'Receipts' as DocumentCategory,
  },
  {
    id: 'hindi',
    label: 'Hindi + EN Circular',
    src: '/src/assets/images/sample_hindi_notice_1795454310304.jpg',
    category: 'Certificates' as DocumentCategory,
  },
  {
    id: 'idcard',
    label: 'Employee ID Badge',
    src: '/src/assets/images/sample_id_card_1795454310924.jpg',
    category: 'ID_Cards' as DocumentCategory,
  },
];

const DOC_TYPES = [
  'A4 Document',
  'Letter Document',
  'Receipt',
  'Passport Page',
  'Certificate',
  'Form',
  'Note',
  'Custom Size',
];

export function ScannerCameraStudio({
  mode,
  settings,
  onModeChange,
  onQuickCaptureSave,
  onClose,
}: ScannerCameraStudioProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wifiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevGrayRef = useRef<Float32Array | null>(null);
  const lastAutoCaptureAtRef = useRef<number>(0);

  const [feedSource, setFeedSource] = useState<'device' | 'wifi'>('device');
  const [wifiCameras, setWifiCameras] = useState<WifiCameraSource[]>([]);
  const [activeWifiCamId, setActiveWifiCamId] = useState('virtual-wifi-cam');
  const [wifiCamStatus, setWifiCamStatus] = useState('Ready');
  const [showAddWifiForm, setShowAddWifiForm] = useState(false);
  const [newWifiName, setNewWifiName] = useState('');
  const [newWifiUrl, setNewWifiUrl] = useState('http://192.168.1.');

  const [zoomLevel, setZoomLevel] = useState(1);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [activeSampleIdx, setActiveSampleIdx] = useState(0);
  const [docTypePreset, setDocTypePreset] = useState(DOC_TYPES[0]);
  const [flashActive, setFlashActive] = useState(false);
  const [quickCount, setQuickCount] = useState(0);
  const [statusBanner, setStatusBanner] = useState('');
  const [gridOverlay, setGridOverlay] = useState(true);
  const [mirrorView, setMirrorView] = useState(false);
  const [timerDelaySec, setTimerDelaySec] = useState<0 | 3>(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Auto Capture real-time telemetry
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [sensitivity, setSensitivity] = useState(settings.autoCaptureSensitivity || 7);
  const [autoState, setAutoState] = useState<'searching' | 'detected' | 'hold-steady' | 'ready' | 'captured'>(
    'searching'
  );
  const [stabilityPct, setStabilityPct] = useState(0);

  // ID Card dual-side state
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [idPresetName, setIdPresetName] = useState('Standard Card (CR80)');

  // Batch scan session state
  const [batchPages, setBatchPages] = useState<string[]>([]);
  const [savingBatch, setSavingBatch] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getSavedWifiCameras().then((cams) => {
      setWifiCameras(cams);
      if (cams.length > 0) setActiveWifiCamId(cams[0].id);
    });
  }, []);

  // Start / Stop real WebRTC camera
  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera API unavailable in this browser context. Using Sample Feed & Gallery Import.');
        setCameraActive(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: settings.resolution === 'high' ? 1920 : 1280 },
          height: { ideal: settings.resolution === 'high' ? 1080 : 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraError('Live camera not attached or permission denied — Sample Viewfinder & File Import are ready.');
      setCameraActive(false);
    }
  }, [settings.resolution]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [startCamera]);

  // Draw active sample feed onto canvas when live webcam isn't running
  useEffect(() => {
    if (cameraActive || feedSource !== 'device') return;
    let mounted = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = SAMPLE_SCENES[activeSampleIdx].src;
    img.onload = () => {
      if (!mounted || !sampleCanvasRef.current) return;
      const c = sampleCanvasRef.current;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
    };
    return () => {
      mounted = false;
    };
  }, [cameraActive, activeSampleIdx, feedSource]);

  // Poll Wi-Fi / IP Camera snapshot stream onto wifiCanvasRef
  useEffect(() => {
    if (feedSource !== 'wifi') return;
    const cam = wifiCameras.find((c) => c.id === activeWifiCamId) || wifiCameras[0];
    if (!cam) return;

    let cancelled = false;
    let timer: number | null = null;

    const drawFrame = () => {
      if (cancelled) return;
      const canvas = wifiCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      if (cam.kind === 'virtual-demo') {
        img.src = SAMPLE_SCENES[activeSampleIdx].src;
      } else {
        img.src = getWifiCameraProxyUrl(cam.snapshotUrl);
      }

      img.onload = () => {
        if (cancelled) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        setWifiCamStatus(
          cam.kind === 'virtual-demo' ? `Wi-Fi Stream Active · ${cam.name}` : `Connected · ${cam.name}`
        );
        timer = window.setTimeout(drawFrame, cam.pollMs || 500);
      };
      img.onerror = () => {
        if (cancelled) return;
        setWifiCamStatus(`Waiting for camera at ${cam.snapshotUrl} — retrying...`);
        timer = window.setTimeout(drawFrame, 1500);
      };
    };

    drawFrame();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [feedSource, wifiCameras, activeWifiCamId, activeSampleIdx]);

  const handleAddWifiCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = newWifiUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setStatusBanner('Wi-Fi camera URL must start with http:// or https://');
      return;
    }
    const cam: WifiCameraSource = {
      id: `wifi_${Date.now()}`,
      name: newWifiName.trim() || `Wi-Fi Camera (${new URL(url).hostname})`,
      snapshotUrl: url,
      pollMs: 450,
      kind: 'http-snapshot',
    };
    const updated = [...wifiCameras, cam];
    setWifiCameras(updated);
    setActiveWifiCamId(cam.id);
    setFeedSource('wifi');
    setShowAddWifiForm(false);
    setNewWifiName('');
    await saveWifiCameras(updated);
    setStatusBanner(`Added Wi-Fi camera: ${cam.name}`);
  };

  const handleRemoveWifiCamera = async (id: string) => {
    const updated = wifiCameras.filter((c) => c.id !== id);
    setWifiCameras(updated);
    if (activeWifiCamId === id && updated.length > 0) {
      setActiveWifiCamId(updated[0].id);
    }
    await saveWifiCameras(updated);
  };

  const grabCurrentFrameDataUrl = useCallback((): string | null => {
    const quality = settings.jpegQuality || 0.88;
    const fmt = settings.defaultFormat || 'image/jpeg';

    let srcEl: HTMLVideoElement | HTMLCanvasElement | null = null;
    let srcW = 0;
    let srcH = 0;

    if (feedSource === 'wifi' && wifiCanvasRef.current && wifiCanvasRef.current.width > 0) {
      srcEl = wifiCanvasRef.current;
      srcW = wifiCanvasRef.current.width;
      srcH = wifiCanvasRef.current.height;
    } else if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
      srcEl = videoRef.current;
      srcW = videoRef.current.videoWidth;
      srcH = videoRef.current.videoHeight;
    } else if (sampleCanvasRef.current && sampleCanvasRef.current.width > 0) {
      srcEl = sampleCanvasRef.current;
      srcW = sampleCanvasRef.current.width;
      srcH = sampleCanvasRef.current.height;
    }

    if (!srcEl || srcW === 0 || srcH === 0) return null;

    // Apply zoom center-crop when zoomLevel > 1
    const cropW = Math.round(srcW / zoomLevel);
    const cropH = Math.round(srcH / zoomLevel);
    const sx = Math.round((srcW - cropW) / 2);
    const sy = Math.round((srcH - cropH) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(srcEl, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    return canvas.toDataURL(fmt, quality);
  }, [cameraActive, feedSource, settings.defaultFormat, settings.jpegQuality, zoomLevel]);

  const triggerCapture = useCallback(async () => {
    const rawDataUrl = grabCurrentFrameDataUrl();
    if (!rawDataUrl) return;

    // Visual shutter flash (< 160ms, non-blocking)
    setFlashActive(true);
    window.setTimeout(() => setFlashActive(false), 140);

    if (mode === 'id-card') {
      if (!idFront) {
        setIdFront(rawDataUrl);
        setStatusBanner('Front side captured. Align Back side and tap Capture.');
      } else {
        setIdBack(rawDataUrl);
        setStatusBanner('Back side captured. Ready to combine into single PDF or Image.');
      }
      return;
    }

    if (mode === 'batch') {
      setBatchPages((prev) => [...prev, rawDataUrl]);
      setStatusBanner(`Page ${batchPages.length + 1} added to batch session.`);
      return;
    }

    // Quick Capture, Auto Capture, Document Scan, Image Scan:
    // Priority: Instant local save & camera remains immediately ready!
    setQuickCount((c) => c + 1);
    const chosenSample = SAMPLE_SCENES[activeSampleIdx];
    const targetCategory: DocumentCategory =
      mode === 'image'
        ? 'Images'
        : mode === 'document' && docTypePreset === 'Receipt'
        ? 'Receipts'
        : !cameraActive
        ? chosenSample.category
        : settings.destinationFolder;

    const titlePrefix =
      mode === 'quick'
        ? 'Quick Scan'
        : mode === 'auto'
        ? 'Auto Scan'
        : mode === 'image'
        ? 'Image Scan'
        : docTypePreset;

    setStatusBanner(`Captured & queued (${titlePrefix}). Camera ready.`);

    // Fire-and-forget immediate save + background enhancement
    void (async () => {
      let finalUrl = rawDataUrl;
      if (settings.autoEnhance && mode !== 'image') {
        try {
          const enhanced = await processImage(rawDataUrl, {
            ...DEFAULT_ADJUSTMENTS,
            filterMode: settings.defaultFilter,
            quality: settings.jpegQuality,
            format: settings.defaultFormat,
            maxWidth: settings.resolution === 'fast' ? 1100 : 1600,
          });
          finalUrl = enhanced.dataUrl;
        } catch {
          finalUrl = rawDataUrl;
        }
      }
      const ext = settings.defaultFormat === 'image/png' ? 'png' : settings.defaultFormat === 'image/webp' ? 'webp' : 'jpg';
      await onQuickCaptureSave({
        dataUrl: finalUrl,
        title: `${titlePrefix} #${quickCount + 1}`,
        category: targetCategory,
        mimeType: settings.defaultFormat,
        fileExtension: ext,
      });
    })();
  }, [
    activeSampleIdx,
    batchPages.length,
    cameraActive,
    docTypePreset,
    grabCurrentFrameDataUrl,
    idFront,
    mode,
    onQuickCaptureSave,
    quickCount,
    settings.autoEnhance,
    settings.defaultFilter,
    settings.defaultFormat,
    settings.destinationFolder,
    settings.jpegQuality,
    settings.resolution,
  ]);

  // Auto Capture stability & blur polling loop
  useEffect(() => {
    if (mode !== 'auto' || !autoEnabled) {
      setAutoState('searching');
      setStabilityPct(0);
      return;
    }

    let steadyStreak = 0;
    const interval = window.setInterval(() => {
      const aCanvas = analysisCanvasRef.current;
      if (!aCanvas) return;
      const ctx = aCanvas.getContext('2d');
      if (!ctx) return;

      const sourceEl =
        feedSource === 'wifi' && wifiCanvasRef.current && wifiCanvasRef.current.width > 0
          ? wifiCanvasRef.current
          : cameraActive && videoRef.current && videoRef.current.videoWidth > 0
          ? videoRef.current
          : sampleCanvasRef.current;
      if (!sourceEl) return;

      aCanvas.width = 120;
      aCanvas.height = 90;
      ctx.drawImage(sourceEl, 0, 0, 120, 90);

      const res = analyzeFrameStability(aCanvas, prevGrayRef.current, sensitivity);
      prevGrayRef.current = res.currentGray;

      if (res.status === 'ready') {
        steadyStreak += 1;
        setStabilityPct(Math.min(100, steadyStreak * 34));
        if (steadyStreak >= 3) {
          const now = Date.now();
          if (now - lastAutoCaptureAtRef.current > 3500) {
            lastAutoCaptureAtRef.current = now;
            steadyStreak = 0;
            setAutoState('captured');
            void triggerCapture();
            window.setTimeout(() => setAutoState('searching'), 1200);
            return;
          }
        }
        setAutoState('ready');
      } else {
        steadyStreak = Math.max(0, steadyStreak - 1);
        setStabilityPct(steadyStreak * 25);
        setAutoState(res.status);
      }
    }, 350);

    return () => window.clearInterval(interval);
  }, [mode, autoEnabled, cameraActive, sensitivity, triggerCapture]);

  const handleGalleryFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        if (mode === 'batch') {
          setBatchPages((prev) => [...prev, dataUrl]);
        } else if (mode === 'id-card') {
          if (!idFront) setIdFront(dataUrl);
          else setIdBack(dataUrl);
        } else {
          await onQuickCaptureSave({
            dataUrl,
            title: file.name.replace(/\.[^.]+$/, ''),
            category: mode === 'image' ? 'Images' : 'Imported',
            mimeType: file.type || 'image/jpeg',
            fileExtension: file.name.split('.').pop() || 'jpg',
          });
          setStatusBanner(`Imported ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleFinishIdCard = async (asPdf: boolean) => {
    if (!idFront) return;
    setSavingBatch(true);
    try {
      if (asPdf) {
        const pdf = await idCardToSinglePdf(idFront, idBack, settings.jpegQuality);
        await onQuickCaptureSave({
          dataUrl: pdf.dataUrl,
          title: `ID Card (${idPresetName})`,
          category: 'ID_Cards',
          mimeType: 'application/pdf',
          fileExtension: 'pdf',
          pageCount: 1,
        });
      } else {
        // Combine Front + Back vertically into single image
        const imgF = new Image();
        imgF.src = idFront;
        await new Promise((r) => (imgF.onload = r));
        const canvas = document.createElement('canvas');
        canvas.width = imgF.width;
        canvas.height = idBack ? imgF.height * 2 + 40 : imgF.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(imgF, 0, 0);
          if (idBack) {
            const imgB = new Image();
            imgB.src = idBack;
            await new Promise((r) => (imgB.onload = r));
            ctx.drawImage(imgB, 0, imgF.height + 40, imgF.width, imgF.height);
          }
          await onQuickCaptureSave({
            dataUrl: canvas.toDataURL('image/jpeg', settings.jpegQuality),
            title: `ID Card Image (${idPresetName})`,
            category: 'ID_Cards',
            mimeType: 'image/jpeg',
            fileExtension: 'jpg',
          });
        }
      }
      setIdFront(null);
      setIdBack(null);
      setStatusBanner('ID Card saved and queued for transfer.');
    } finally {
      setSavingBatch(false);
    }
  };

  const handleFinishBatchToPdf = async () => {
    if (batchPages.length === 0) return;
    setSavingBatch(true);
    try {
      const pdf = await imagesToPdf(batchPages);
      await onQuickCaptureSave({
        dataUrl: pdf.dataUrl,
        title: `Batch Scan (${batchPages.length} pages)`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: pdf.pageCount,
        pages: batchPages,
      });
      setBatchPages([]);
      setStatusBanner(`Combined ${pdf.pageCount} pages into PDF & queued for transfer.`);
    } finally {
      setSavingBatch(false);
    }
  };

  const modeTabs: Array<{ id: CaptureMode; label: string; icon: typeof Zap }> = [
    { id: 'quick', label: 'Quick', icon: Zap },
    { id: 'auto', label: 'Auto', icon: ScanLine },
    { id: 'document', label: 'Document', icon: FilePlus2 },
    { id: 'image', label: 'Image', icon: FolderOpen },
    { id: 'id-card', label: 'ID Card', icon: CreditCard },
    { id: 'batch', label: 'Batch', icon: Layers },
  ];

  const autoIndicatorText = {
    searching: 'Scanning frame for document edges...',
    detected: 'Document detected — keep inside frame',
    'hold-steady': 'Hold steady — sharpening focus',
    ready: `Ready to capture (${stabilityPct}%)`,
    captured: 'Captured successfully',
  }[autoState];

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white rounded-2xl overflow-hidden border border-slate-800">
      {/* Mode Selector Strip */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-900 border-b border-slate-800 overflow-x-auto">
        <div className="flex items-center gap-1">
          {modeTabs.map((t) => {
            const Icon = t.icon;
            const active = mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onModeChange(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Done
          </button>
        )}
      </div>

      {/* Contextual Preset Strip + Wi-Fi Camera Source + Zoom Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-900/70 border-b border-slate-800/80 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex p-0.5 bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFeedSource('device')}
              className={`px-2.5 py-1 rounded-md font-medium ${
                feedSource === 'device' ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Device Cam
            </button>
            <button
              type="button"
              onClick={() => setFeedSource('wifi')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium ${
                feedSource === 'wifi' ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Wifi className="w-3 h-3" />
              Wi-Fi Camera
            </button>
          </div>

          {feedSource === 'wifi' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={activeWifiCamId}
                onChange={(e) => setActiveWifiCamId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white max-w-[200px]"
              >
                {wifiCameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAddWifiForm((s) => !s)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-800 hover:bg-emerald-700 text-white font-medium"
              >
                <Plus className="w-3 h-3" />
                Add Wi-Fi Cam
              </button>
              {wifiCameras.find((c) => c.id === activeWifiCamId)?.kind === 'http-snapshot' && (
                <button
                  type="button"
                  onClick={() => void handleRemoveWifiCamera(activeWifiCamId)}
                  className="p-1 text-red-400 hover:text-red-300"
                  title="Remove saved Wi-Fi camera"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {(!cameraActive || (feedSource === 'wifi' && wifiCameras.find((c) => c.id === activeWifiCamId)?.kind === 'virtual-demo')) && (
            <>
              <span className="text-slate-400">Scene:</span>
              {SAMPLE_SCENES.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSampleIdx(idx)}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeSampleIdx === idx
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </>
          )}
          {mode === 'document' && (
            <select
              value={docTypePreset}
              onChange={(e) => setDocTypePreset(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white"
            >
              {DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {mode === 'id-card' && (
            <select
              value={idPresetName}
              onChange={(e) => setIdPresetName(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white"
            >
              <option value="Standard Card (CR80)">Standard Card (CR80)</option>
              <option value="Passport / Booklet">Passport / Booklet</option>
              <option value="Custom Badge Size">Custom Badge Size</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Optical / Digital Zoom Control */}
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg px-2 py-1">
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
              className="p-0.5 text-slate-300 hover:text-white"
              aria-label="Zoom out camera"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            {([1, 1.5, 2, 3] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setZoomLevel(preset)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums ${
                  zoomLevel === preset ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {preset}x
              </button>
            ))}
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="p-0.5 text-slate-300 hover:text-white"
              aria-label="Zoom in camera"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {mode === 'auto' && (
            <div className="flex items-center gap-2">
              <label className="text-slate-300 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  onChange={(e) => setAutoEnabled(e.target.checked)}
                  className="accent-emerald-500"
                />
                Auto-Trigger
              </label>
              <label className="flex items-center gap-1.5 text-slate-400">
                Sensitivity
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-16 accent-emerald-500"
                />
              </label>
            </div>
          )}
          <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2">
            <button
              type="button"
              onClick={() => setGridOverlay((g) => !g)}
              className={`p-1.5 rounded-md ${gridOverlay ? 'bg-emerald-800 text-white' : 'bg-slate-800 text-slate-300'}`}
              title="Toggle Alignment Grid"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMirrorView((m) => !m)}
              className={`p-1.5 rounded-md ${mirrorView ? 'bg-emerald-800 text-white' : 'bg-slate-800 text-slate-300'}`}
              title="Mirror Viewfinder"
            >
              <FlipHorizontal2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTimerDelaySec((t) => (t === 0 ? 3 : 0))}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                timerDelaySec === 3 ? 'bg-emerald-800 text-white' : 'bg-slate-800 text-slate-300'
              }`}
              title="3s Self-Timer"
            >
              <Timer className="w-3.5 h-3.5" />
              {timerDelaySec === 3 ? '3s' : '0s'}
            </button>
          </div>
          {feedSource === 'device' && cameraError && (
            <button
              type="button"
              onClick={startCamera}
              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
            >
              <RotateCcw className="w-3 h-3" />
              Retry Camera
            </button>
          )}
        </div>
      </div>

      {/* Add External Wi-Fi Camera Drawer */}
      {showAddWifiForm && (
        <form
          onSubmit={handleAddWifiCamera}
          className="px-4 py-2.5 bg-slate-900 border-b border-emerald-900/60 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-emerald-300 font-semibold">Add External Wi-Fi / IP Camera:</span>
          <input
            type="text"
            value={newWifiName}
            onChange={(e) => setNewWifiName(e.target.value)}
            placeholder="Camera Name (e.g. Desk Android Cam)"
            className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-white w-48"
          />
          <input
            type="url"
            required
            value={newWifiUrl}
            onChange={(e) => setNewWifiUrl(e.target.value)}
            placeholder="http://192.168.1.50:8080/shot.jpg"
            className="flex-1 min-w-[220px] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-white font-mono"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded-md"
          >
            Connect & Save
          </button>
          <button
            type="button"
            onClick={() => setShowAddWifiForm(false)}
            className="px-2.5 py-1.5 text-slate-400 hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Main Viewfinder */}
      <div className="relative flex-1 min-h-[340px] flex items-center justify-center bg-black overflow-hidden p-3">
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            transform: `${mirrorView ? 'scaleX(-1) ' : ''}scale(${zoomLevel})`,
            transformOrigin: 'center center',
          }}
          className={`max-h-full max-w-full rounded-lg object-contain transition-transform duration-150 ${
            feedSource === 'device' && cameraActive ? 'block' : 'hidden'
          }`}
        />
        <canvas
          ref={sampleCanvasRef}
          style={{
            transform: `${mirrorView ? 'scaleX(-1) ' : ''}scale(${zoomLevel})`,
            transformOrigin: 'center center',
          }}
          className={`max-h-full max-w-full rounded-lg object-contain transition-transform duration-150 ${
            feedSource === 'device' && !cameraActive ? 'block' : 'hidden'
          }`}
        />
        <canvas
          ref={wifiCanvasRef}
          style={{
            transform: `${mirrorView ? 'scaleX(-1) ' : ''}scale(${zoomLevel})`,
            transformOrigin: 'center center',
          }}
          className={`max-h-full max-w-full rounded-lg object-contain transition-transform duration-150 ${
            feedSource === 'wifi' ? 'block' : 'hidden'
          }`}
        />
        <canvas ref={analysisCanvasRef} className="hidden" />

        {feedSource === 'wifi' && (
          <div className="absolute top-3 left-4 z-10 bg-slate-900/85 border border-emerald-700/60 px-2.5 py-1 rounded-lg text-[11px] text-emerald-200 flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>{wifiCamStatus}</span>
          </div>
        )}

        {/* Viewfinder Frame & Alignment Grid Overlay */}
        <div className="pointer-events-none absolute inset-6 border border-emerald-400/35 rounded-xl flex flex-col justify-between p-3 overflow-hidden">
          {gridOverlay && (
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border border-white/10" />
              ))}
            </div>
          )}
          <div className="flex justify-between relative z-10">
            <span className="w-5 h-5 border-t-2 border-l-2 border-emerald-400 rounded-tl" />
            <span className="w-5 h-5 border-t-2 border-r-2 border-emerald-400 rounded-tr" />
          </div>
          <div className="flex justify-between relative z-10">
            <span className="w-5 h-5 border-b-2 border-l-2 border-emerald-400 rounded-bl" />
            <span className="w-5 h-5 border-b-2 border-r-2 border-emerald-400 rounded-br" />
          </div>
        </div>

        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 rounded-full bg-emerald-950/85 border-2 border-emerald-400 text-white text-3xl font-mono font-bold flex items-center justify-center tabular-nums">
              {countdown}
            </div>
          </div>
        )}

        {/* Auto Capture HUD */}
        {mode === 'auto' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                autoState === 'ready' || autoState === 'captured'
                  ? 'bg-emerald-400'
                  : autoState === 'hold-steady'
                  ? 'bg-amber-400'
                  : 'bg-slate-400'
              }`}
            />
            <span>{autoIndicatorText}</span>
          </div>
        )}

        {/* Shutter Flash */}
        {flashActive && <div className="absolute inset-0 bg-white/80 pointer-events-none transition-opacity" />}

        {/* Quick / Status Confirmation Toast */}
        {statusBanner && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-emerald-900/95 border border-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 shadow-lg max-w-[90%] truncate">
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
            <span className="truncate">{statusBanner}</span>
          </div>
        )}
      </div>

      {/* ID Card Preview Tray */}
      {mode === 'id-card' && (idFront || idBack) && (
        <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-xs">
              <div className="text-slate-400">Front</div>
              {idFront ? (
                <img src={idFront} alt="ID Front" className="h-12 w-20 object-cover rounded border border-emerald-500" />
              ) : (
                <div className="h-12 w-20 rounded border border-dashed border-slate-700 flex items-center justify-center text-slate-500">
                  Pending
                </div>
              )}
            </div>
            <div className="text-xs">
              <div className="text-slate-400">Back</div>
              {idBack ? (
                <img src={idBack} alt="ID Back" className="h-12 w-20 object-cover rounded border border-emerald-500" />
              ) : (
                <div className="h-12 w-20 rounded border border-dashed border-slate-700 flex items-center justify-center text-slate-500">
                  Optional
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIdFront(null);
                setIdBack(null);
              }}
              className="px-3 py-2 text-xs text-slate-300 hover:text-white bg-slate-800 rounded-lg"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => handleFinishIdCard(false)}
              disabled={savingBatch}
              className="px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
            >
              Save Single Image
            </button>
            <button
              type="button"
              onClick={() => handleFinishIdCard(true)}
              disabled={savingBatch}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              Combine to PDF
            </button>
          </div>
        </div>
      )}

      {/* Batch Session Filmstrip */}
      {mode === 'batch' && batchPages.length > 0 && (
        <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1">
            {batchPages.map((pg, idx) => (
              <div key={idx} className="relative shrink-0 group bg-slate-800 rounded-lg p-1 border border-slate-700">
                <img src={pg} alt={`Page ${idx + 1}`} className="h-14 w-11 object-cover rounded" />
                <div className="flex items-center justify-between gap-0.5 mt-1 text-[10px] text-slate-300 tabular-nums">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() =>
                      setBatchPages((prev) => {
                        const copy = [...prev];
                        [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                        return copy;
                      })
                    }
                    className="p-0.5 hover:text-white disabled:opacity-30"
                    aria-label="Move page left"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <span>{idx + 1}</span>
                  <button
                    type="button"
                    disabled={idx === batchPages.length - 1}
                    onClick={() =>
                      setBatchPages((prev) => {
                        const copy = [...prev];
                        [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                        return copy;
                      })
                    }
                    className="p-0.5 hover:text-white disabled:opacity-30"
                    aria-label="Move page right"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchPages((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-0.5 text-red-400 hover:text-red-300"
                    aria-label="Delete page"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleFinishBatchToPdf}
            disabled={savingBatch}
            className="px-4 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shrink-0"
          >
            {savingBatch ? 'Building PDF...' : `Combine ${batchPages.length} Pages to PDF`}
          </button>
        </div>
      )}

      {/* Bottom Shutter Control Deck */}
      <div className="px-5 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 min-h-[44px]"
        >
          <Upload className="w-4 h-4 text-emerald-400" />
          Import Gallery
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleGalleryFiles}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => {
            if (timerDelaySec === 0) {
              void triggerCapture();
            } else if (countdown === null) {
              setCountdown(3);
              let left = 3;
              const iv = window.setInterval(() => {
                left -= 1;
                if (left <= 0) {
                  window.clearInterval(iv);
                  setCountdown(null);
                  void triggerCapture();
                } else {
                  setCountdown(left);
                }
              }, 1000);
            }
          }}
          aria-label="Capture Scan"
          className="w-16 h-16 rounded-full bg-white p-1 border-4 border-emerald-500 flex items-center justify-center active:scale-95 transition-transform shadow-lg"
        >
          <div className="w-full h-full rounded-full bg-emerald-700 hover:bg-emerald-600 flex items-center justify-center">
            <Camera className="w-6 h-6 text-white" />
          </div>
        </button>

        <div className="text-right min-w-[110px]">
          <div className="text-xs font-mono tabular-nums text-emerald-400">
            {mode === 'batch'
              ? `${batchPages.length} pages`
              : mode === 'id-card'
              ? idFront
                ? idBack
                  ? '2/2 sides'
                  : '1/2 front'
                : '0/2 sides'
              : `${quickCount} captured`}
          </div>
          <div className="text-[11px] text-slate-400">
            {settings.autoTransfer ? 'Auto-transfer ON' : 'Local save only'}
          </div>
        </div>
      </div>
    </div>
  );
}
