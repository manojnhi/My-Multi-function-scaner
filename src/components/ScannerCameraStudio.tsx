import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileInput,
  Grid3X3,
  Image as ImageIcon,
  Layers,
  Plus,
  Settings,
  Trash2,
  Wifi,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSavedWifiCameras, saveWifiCameras } from '../services/db';
import {
  analyzeFrameStability,
  applyOkenScenePreset,
  composeIdCardA4Sheet,
  detectDocumentCorners,
  detectLiveFrameCorners,
  splitBookSpread,
  warpPerspective,
} from '../services/imageProcessor';
import { runOcrExtraction } from '../services/ocrService';
import {
  type AutoScanPhase,
  defaultPaperCorners,
  evaluateAutoScanStep,
  OKEN_SCENE_PRESETS,
  type OkenScenePresetId,
  smoothCorners,
} from '../services/paperCropMath';
import { idCardToSinglePdf, imagesToPdf } from '../services/pdfService';
import { getWifiCameraProxyUrl } from '../services/syncClient';
import type {
  CornerPoint,
  DocumentCategory,
  DocumentFilterMode,
  ScannerSettings,
  WifiCameraSource,
} from '../types';
import { OkenReviewStudio } from './OkenReviewStudio';

export type CaptureMode =
  | 'book'
  | 'to-text'
  | 'document'
  | 'auto'
  | 'quick'
  | 'image'
  | 'id-card'
  | 'qr-code'
  | 'batch';

type IdCardTemplate = 'single' | 'license' | 'passport';

interface PendingReview {
  rawUrl: string;
  croppedUrl: string;
  corners: CornerPoint[];
  title: string;
  category: DocumentCategory;
  modeAtCapture: CaptureMode;
}

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

  // Clean 5-icon top bar states matching Oken capture UI
  const [flashMode, setFlashMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [hdEnabled, setHdEnabled] = useState(settings.resolution !== 'fast');
  const [defaultPreset, setDefaultPreset] = useState<OkenScenePresetId>('auto');
  const [showPresetStrip, setShowPresetStrip] = useState(false);
  const [gridOverlay, setGridOverlay] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);

  // Camera source & sample fallback state (tucked cleanly inside Gear settings)
  const [feedSource, setFeedSource] = useState<'device' | 'wifi'>('device');
  const [wifiCameras, setWifiCameras] = useState<WifiCameraSource[]>([]);
  const [activeWifiCamId, setActiveWifiCamId] = useState('virtual-wifi-cam');
  const [showAddWifiForm, setShowAddWifiForm] = useState(false);
  const [newWifiName, setNewWifiName] = useState('');
  const [newWifiUrl, setNewWifiUrl] = useState('http://192.168.1.');

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [activeSampleIdx, setActiveSampleIdx] = useState(0);
  const [flashActive, setFlashActive] = useState(false);
  const [quickCount, setQuickCount] = useState(0);
  const [statusBanner, setStatusBanner] = useState('');

  // Paper-edge auto-crop state (live green polygon)
  const [autoCropPaper, setAutoCropPaper] = useState(settings.autoCrop ?? true);
  const [liveCorners, setLiveCorners] = useState<CornerPoint[]>(defaultPaperCorners());
  const [paperDetected, setPaperDetected] = useState(false);
  const liveCornersRef = useRef<CornerPoint[]>(defaultPaperCorners());
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [croppingBusy, setCroppingBusy] = useState(false);

  // Auto search -> auto selection -> quick capture (enabled by default in scan modes)
  const isAutoCapableMode =
    mode === 'document' ||
    mode === 'auto' ||
    mode === 'quick' ||
    mode === 'to-text' ||
    mode === 'book';
  const [autoEnabled, setAutoEnabled] = useState(isAutoCapableMode);
  const [autoPhase, setAutoPhase] = useState<AutoScanPhase>('searching');
  const [lockProgressPct, setLockProgressPct] = useState(0);
  const [autoPausedAfterCapture, setAutoPausedAfterCapture] = useState(false);
  const [sensitivity] = useState(settings.autoCaptureSensitivity || 7);

  // ID Card 1:1 A4 Maker state
  const [idTemplate, setIdTemplate] = useState<IdCardTemplate>('license');
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [idA4Preview, setIdA4Preview] = useState<string | null>(null);

  // QR & To-Text result state
  const [qrResult, setQrResult] = useState('');
  const [extractedSnippet, setExtractedSnippet] = useState('');

  // Multi-page batch / book session
  const [batchPages, setBatchPages] = useState<string[]>([]);
  const [savingBatch, setSavingBatch] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setAutoEnabled(
      mode === 'document' ||
        mode === 'auto' ||
        mode === 'quick' ||
        mode === 'to-text' ||
        mode === 'book'
    );
    setAutoPausedAfterCapture(false);
    setAutoPhase('searching');
    setLockProgressPct(0);
  }, [mode]);

  useEffect(() => {
    getSavedWifiCameras().then((cams) => {
      setWifiCameras(cams);
      if (cams.length > 0) setActiveWifiCamId(cams[0].id);
    });
  }, []);

  useEffect(() => {
    if (mode !== 'id-card' || !idFront) {
      setIdA4Preview(null);
      return;
    }
    let cancelled = false;
    composeIdCardA4Sheet(idFront, idBack, idTemplate, 0.85)
      .then((res) => {
        if (!cancelled) setIdA4Preview(res.dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, idFront, idBack, idTemplate]);

  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera unavailable');
        setCameraActive(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: hdEnabled ? 1920 : 1280 },
          height: { ideal: hdEnabled ? 1080 : 720 },
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
      setCameraError('Using preview camera feed');
      setCameraActive(false);
    }
  }, [hdEnabled]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [startCamera]);

  // Draw active sample feed when live webcam isn't active
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

  // Poll Wi-Fi camera when selected in Gear Settings
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
      img.src =
        cam.kind === 'virtual-demo'
          ? SAMPLE_SCENES[activeSampleIdx].src
          : getWifiCameraProxyUrl(cam.snapshotUrl);

      img.onload = () => {
        if (cancelled) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        timer = window.setTimeout(drawFrame, cam.pollMs || 500);
      };
      img.onerror = () => {
        if (cancelled) return;
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
    setStatusBanner(`Connected ${cam.name}`);
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

    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(srcEl, 0, 0, srcW, srcH);
    return canvas.toDataURL(fmt, quality);
  }, [cameraActive, feedSource, settings.defaultFormat, settings.jpegQuality]);

  const cropToPaperEdges = useCallback(
    async (
      rawDataUrl: string,
      hintCorners?: CornerPoint[]
    ): Promise<{ croppedUrl: string; corners: CornerPoint[] }> => {
      if (!autoCropPaper || mode === 'image' || mode === 'qr-code') {
        return {
          croppedUrl: rawDataUrl,
          corners: [
            { x: 0.02, y: 0.02 },
            { x: 0.98, y: 0.02 },
            { x: 0.98, y: 0.98 },
            { x: 0.02, y: 0.98 },
          ],
        };
      }
      try {
        const detected = hintCorners || (await detectDocumentCorners(rawDataUrl));
        const warped = await warpPerspective(rawDataUrl, detected, hdEnabled ? 1700 : 1200);
        return { croppedUrl: warped.dataUrl, corners: detected };
      } catch {
        return { croppedUrl: rawDataUrl, corners: defaultPaperCorners() };
      }
    },
    [autoCropPaper, hdEnabled, mode]
  );

  const triggerCapture = useCallback(
    async (isAutoTrigger = false) => {
      if (pendingReview) return;
      const rawDataUrl = grabCurrentFrameDataUrl();
      if (!rawDataUrl) return;

      setFlashActive(true);
      window.setTimeout(() => setFlashActive(false), 140);

      if (mode === 'qr-code') {
        try {
          const img = new Image();
          img.src = rawDataUrl;
          await new Promise((r) => (img.onload = r));

          const qCanvas = document.createElement('canvas');
          qCanvas.width = img.width;
          qCanvas.height = img.height;
          const qCtx = qCanvas.getContext('2d', { willReadFrequently: true });
          if (qCtx) {
            qCtx.drawImage(img, 0, 0);
            const imgData = qCtx.getImageData(0, 0, qCanvas.width, qCanvas.height);
            const jsHit = jsQR(imgData.data, qCanvas.width, qCanvas.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (jsHit?.data) {
              setQrResult(jsHit.data);
              setStatusBanner(`QR decoded: ${jsHit.data.slice(0, 48)}`);
              return;
            }
          }

          const Detector = (
            window as unknown as {
              BarcodeDetector?: new (opts?: { formats?: string[] }) => {
                detect: (img: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
              };
            }
          ).BarcodeDetector;
          if (Detector) {
            const det = new Detector({ formats: ['qr_code', 'code_128', 'ean_13'] });
            const found = await det.detect(img);
            if (found.length > 0 && found[0].rawValue) {
              setQrResult(found[0].rawValue);
              setStatusBanner(`QR decoded: ${found[0].rawValue.slice(0, 48)}`);
              return;
            }
          }
        } catch {
          // fallback below
        }
        setQrResult('No live QR code detected in frame — saved frame.');
      }

      setCroppingBusy(true);
      try {
        const hintCorners = paperDetected ? liveCornersRef.current : undefined;
        const { croppedUrl, corners } = await cropToPaperEdges(rawDataUrl, hintCorners);

        if (mode === 'id-card') {
          if (!idFront) {
            setIdFront(croppedUrl);
            setStatusBanner('Front side captured. Align Back side and capture.');
          } else {
            setIdBack(croppedUrl);
            setStatusBanner('Back side captured. Tap "Make it now" to save A4 PDF.');
          }
          return;
        }

        if (mode === 'book') {
          const halves = await splitBookSpread(croppedUrl, settings.jpegQuality);
          setBatchPages((prev) => [...prev, halves.left, halves.right]);
          setStatusBanner('Spread cropped & split into 2 pages.');
          return;
        }

        if (mode === 'batch') {
          setBatchPages((prev) => [...prev, croppedUrl]);
          setStatusBanner(`Page ${batchPages.length + 1} added.`);
          return;
        }

        const chosenSample = SAMPLE_SCENES[activeSampleIdx];
        const targetCategory: DocumentCategory =
          mode === 'image'
            ? 'Images'
            : !cameraActive
            ? chosenSample.category
            : settings.destinationFolder;

        const titlePrefix =
          mode === 'to-text'
            ? 'OCR Scan'
            : mode === 'auto' || isAutoTrigger
            ? 'Quick Scan'
            : 'Document';

        if (isAutoTrigger && !cameraActive && feedSource === 'device') {
          setAutoPausedAfterCapture(true);
        }

        setPendingReview({
          rawUrl: rawDataUrl,
          croppedUrl,
          corners,
          title: `${titlePrefix} #${quickCount + 1}`,
          category: targetCategory,
          modeAtCapture: mode,
        });
      } finally {
        setCroppingBusy(false);
      }
    },
    [
      activeSampleIdx,
      autoEnabled,
      batchPages.length,
      cameraActive,
      cropToPaperEdges,
      defaultPreset,
      grabCurrentFrameDataUrl,
      hdEnabled,
      idFront,
      mode,
      onQuickCaptureSave,
      paperDetected,
      pendingReview,
      quickCount,
      settings.defaultFormat,
      settings.destinationFolder,
      settings.jpegQuality,
    ]
  );

  // Live Search -> Auto Document Selection -> Quick Capture polling loop
  useEffect(() => {
    if (pendingReview) return;

    let steadyStreak = 0;
    const interval = window.setInterval(() => {
      const aCanvas = analysisCanvasRef.current;
      if (!aCanvas) return;
      const ctx = aCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const sourceEl =
        feedSource === 'wifi' && wifiCanvasRef.current && wifiCanvasRef.current.width > 0
          ? wifiCanvasRef.current
          : cameraActive && videoRef.current && videoRef.current.videoWidth > 0
          ? videoRef.current
          : sampleCanvasRef.current;
      if (!sourceEl) return;

      const srcW =
        sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.width;
      const srcH =
        sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.height;
      if (!srcW || !srcH) return;

      const aw = 200;
      const ah = Math.max(100, Math.round((srcH / srcW) * aw));
      aCanvas.width = aw;
      aCanvas.height = ah;
      ctx.drawImage(sourceEl, 0, 0, aw, ah);

      let isPaperNow = false;
      if (autoCropPaper && mode !== 'image' && mode !== 'qr-code' && mode !== 'id-card') {
        const edgeRes = detectLiveFrameCorners(aCanvas);
        isPaperNow = edgeRes.detected;
        setPaperDetected(edgeRes.detected);
        if (edgeRes.detected) {
          const smoothed = smoothCorners(liveCornersRef.current, edgeRes.corners, 0.48);
          liveCornersRef.current = smoothed;
          setLiveCorners(smoothed);
        } else {
          const fallback = defaultPaperCorners();
          liveCornersRef.current = fallback;
          setLiveCorners(fallback);
        }
      } else {
        setPaperDetected(false);
      }

      const stability = analyzeFrameStability(aCanvas, prevGrayRef.current, sensitivity);
      prevGrayRef.current = stability.currentGray;

      const step = evaluateAutoScanStep({
        paperDetected: isPaperNow,
        motionScore: stability.motionScore,
        sensitivity,
        steadyStreak,
        autoCaptureEnabled: autoEnabled && !autoPausedAfterCapture,
        nowMs: Date.now(),
        lastCaptureAtMs: lastAutoCaptureAtRef.current,
        cooldownMs: 3600,
        requiredSteadyTicks: 5,
      });

      steadyStreak = step.nextStreak;
      setAutoPhase(step.phase);
      setLockProgressPct(step.progressPct);

      if (step.shouldCapture) {
        lastAutoCaptureAtRef.current = Date.now();
        void triggerCapture(true);
      }
    }, 260);

    return () => window.clearInterval(interval);
  }, [
    autoCropPaper,
    autoEnabled,
    autoPausedAfterCapture,
    cameraActive,
    feedSource,
    mode,
    pendingReview,
    sensitivity,
    triggerCapture,
  ]);

  const handleGalleryFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          await onQuickCaptureSave({
            dataUrl,
            title: file.name.replace(/\.[^.]+$/, ''),
            category: 'PDFs',
            mimeType: 'application/pdf',
            fileExtension: 'pdf',
          });
          setStatusBanner(`Imported ${file.name}`);
          return;
        }
        if (mode === 'batch' || mode === 'book') {
          const { croppedUrl } = await cropToPaperEdges(dataUrl);
          setBatchPages((prev) => [...prev, croppedUrl]);
        } else if (mode === 'id-card') {
          const { croppedUrl } = await cropToPaperEdges(dataUrl);
          if (!idFront) setIdFront(croppedUrl);
          else setIdBack(croppedUrl);
        } else {
          const { croppedUrl, corners } = await cropToPaperEdges(dataUrl);
          setPendingReview({
            rawUrl: dataUrl,
            croppedUrl,
            corners,
            title: file.name.replace(/\.[^.]+$/, ''),
            category: mode === 'image' ? 'Images' : 'Imported',
            modeAtCapture: mode,
          });
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
      const templateLabel =
        idTemplate === 'passport' ? 'Passport' : idTemplate === 'single' ? 'Single Side' : 'Driver License / ID';
      if (asPdf) {
        const pdf = await idCardToSinglePdf(idFront, idBack, settings.jpegQuality);
        await onQuickCaptureSave({
          dataUrl: pdf.dataUrl,
          title: `ID Card (${templateLabel})`,
          category: 'ID_Cards',
          mimeType: 'application/pdf',
          fileExtension: 'pdf',
          pageCount: 1,
        });
      } else {
        const sheet = await composeIdCardA4Sheet(idFront, idBack, idTemplate, settings.jpegQuality);
        await onQuickCaptureSave({
          dataUrl: sheet.dataUrl,
          title: `ID Card A4 (${templateLabel})`,
          category: 'ID_Cards',
          mimeType: 'image/jpeg',
          fileExtension: 'jpg',
        });
      }
      setIdFront(null);
      setIdBack(null);
      setIdA4Preview(null);
      setStatusBanner(`Saved 1:1 A4 ${templateLabel}.`);
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
        title: `${mode === 'book' ? 'Book Scan' : 'Batch Scan'} (${batchPages.length} pages)`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: pdf.pageCount,
        pages: batchPages,
      });
      setBatchPages([]);
      setStatusBanner(`Saved ${pdf.pageCount}-page PDF.`);
    } finally {
      setSavingBatch(false);
    }
  };

  const handleConfirmOkenReview = async (result: {
    dataUrl: string;
    filterMode: DocumentFilterMode;
    title?: string;
    pages?: string[];
  }) => {
    if (!pendingReview) return;
    const ext =
      settings.defaultFormat === 'image/png'
        ? 'png'
        : settings.defaultFormat === 'image/webp'
        ? 'webp'
        : 'jpg';
    const finalTitle = result.title || pendingReview.title;
    setQuickCount((c) => c + 1);
    await onQuickCaptureSave({
      dataUrl: result.dataUrl,
      title: finalTitle,
      category: pendingReview.category,
      mimeType: settings.defaultFormat,
      fileExtension: ext,
      pageCount: result.pages ? result.pages.length : 1,
      pages: result.pages,
    });

    if (pendingReview.modeAtCapture === 'to-text') {
      try {
        const ocr = await runOcrExtraction(result.dataUrl, settings.ocrDefaultLang);
        setExtractedSnippet(ocr.text.trim() || 'No readable text detected.');
      } catch {
        setExtractedSnippet('Saved scan. Open OCR to extract text.');
      }
    }

    setPendingReview(null);
    setStatusBanner(`Saved "${finalTitle}".`);
  };

  if (pendingReview) {
    return (
      <OkenReviewStudio
        rawCaptureUrl={pendingReview.rawUrl}
        initialCroppedUrl={pendingReview.croppedUrl}
        initialCorners={pendingReview.corners}
        initialPreset={pendingReview.modeAtCapture === 'image' ? 'original' : defaultPreset}
        title={pendingReview.title}
        quality={settings.jpegQuality}
        format={settings.defaultFormat}
        saveLabel={pendingReview.modeAtCapture === 'to-text' ? 'Save & Extract Text' : 'Save Scan'}
        onRetake={() => setPendingReview(null)}
        onConfirmSave={handleConfirmOkenReview}
      />
    );
  }

  // Exact 5 modes from Oken capture screen: Book · To Text · Docs · ID Card · QR Code
  const modeTabs: Array<{ id: CaptureMode; label: string }> = [
    { id: 'book', label: 'Book' },
    { id: 'to-text', label: 'To Text' },
    { id: 'document', label: 'Docs' },
    { id: 'id-card', label: 'ID Card' },
    { id: 'qr-code', label: 'QR Code' },
  ];

  // Treat 'auto', 'quick', 'batch', 'image' as active under Docs pill visually if entered via shortcut
  const activeModeForPill: CaptureMode =
    mode === 'auto' || mode === 'quick' || mode === 'batch' || mode === 'image'
      ? 'document'
      : mode;

  return (
    <div className="flex flex-col h-full bg-black text-white select-none overflow-hidden">
      {/* 1. Ultra-Minimal Oken 5-Icon Top Utility Bar */}
      <div className="h-12 px-6 bg-black flex items-center justify-between shrink-0 z-20">
        {/* Flash Auto / On / Off */}
        <button
          type="button"
          onClick={() =>
            setFlashMode((m) => (m === 'auto' ? 'on' : m === 'on' ? 'off' : 'auto'))
          }
          aria-label={`Flash mode ${flashMode}`}
          className="relative p-2 text-white hover:text-emerald-400 transition-colors"
        >
          {flashMode === 'off' ? (
            <ZapOff className="w-5 h-5 text-slate-400" />
          ) : (
            <Zap className={`w-5 h-5 ${flashMode === 'on' ? 'text-amber-400 fill-amber-400' : 'text-white'}`} />
          )}
          {flashMode === 'auto' && (
            <span className="absolute top-1.5 right-0.5 text-[9px] font-bold leading-none text-white">
              A
            </span>
          )}
        </button>

        {/* HD Resolution Toggle */}
        <button
          type="button"
          onClick={() => setHdEnabled((v) => !v)}
          aria-label={hdEnabled ? 'HD Capture ON' : 'HD Capture OFF'}
          className="relative p-1.5 flex items-center justify-center"
        >
          <span
            className={`px-1.5 py-0.5 rounded border text-[11px] font-extrabold tracking-tight leading-none transition-colors ${
              hdEnabled
                ? 'border-white text-white bg-white/10'
                : 'border-slate-500 text-slate-400'
            }`}
          >
            HD
          </span>
          {hdEnabled && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-rose-500" />
          )}
        </button>

        {/* Multi-Scene Color Filter Picker (3-circle Oken icon) */}
        <button
          type="button"
          onClick={() => {
            setShowSettingsSheet(false);
            setShowPresetStrip((s) => !s);
          }}
          aria-label="Scan filter preset"
          className={`p-2 rounded-lg transition-colors ${
            showPresetStrip ? 'text-emerald-400' : 'text-white hover:text-emerald-400'
          }`}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" aria-hidden="true">
            <circle cx="12" cy="8.5" r="4.2" fill="currentColor" fillOpacity="0.88" />
            <circle cx="8.8" cy="14" r="4.2" fill="currentColor" fillOpacity="0.55" />
            <circle cx="15.2" cy="14" r="4.2" fill="currentColor" fillOpacity="0.72" />
          </svg>
        </button>

        {/* Alignment Grid Toggle */}
        <button
          type="button"
          onClick={() => setGridOverlay((g) => !g)}
          aria-label="Toggle alignment grid"
          className={`p-2 transition-colors ${
            gridOverlay ? 'text-emerald-400' : 'text-white hover:text-emerald-400'
          }`}
        >
          <Grid3X3 className="w-5 h-5" />
        </button>

        {/* Compact Settings Cog (tucks optional controls neatly out of sight) */}
        <button
          type="button"
          onClick={() => {
            setShowPresetStrip(false);
            setShowSettingsSheet((s) => !s);
          }}
          aria-label="Camera settings"
          className={`p-2 transition-colors ${
            showSettingsSheet ? 'text-emerald-400' : 'text-white hover:text-emerald-400'
          }`}
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Optional Filter Strip (only shown when Filter icon tapped) */}
      {showPresetStrip && (
        <div className="px-4 py-2 bg-[#111317] border-y border-white/10 flex items-center gap-2 overflow-x-auto shrink-0 z-20">
          {OKEN_SCENE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setDefaultPreset(p.id);
                setShowPresetStrip(false);
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                defaultPreset === p.id
                  ? 'bg-[#00995a] text-white'
                  : 'bg-white/10 text-slate-300 hover:bg-white/15'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Optional Clean Settings Sheet (only shown when Gear icon tapped) */}
      {showSettingsSheet && (
        <div className="px-4 py-3 bg-[#111317] border-y border-white/10 text-xs space-y-3 shrink-0 z-20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                checked={autoCropPaper}
                onChange={(e) => setAutoCropPaper(e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
              Auto-Crop Paper Edges
            </label>
            <label className="flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
              Hands-Free Auto Capture
            </label>
            <button
              type="button"
              onClick={() => onModeChange(mode === 'batch' ? 'document' : 'batch')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium ${
                mode === 'batch' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Multi-Page Batch: {mode === 'batch' ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Camera feed source"
              value={feedSource}
              onChange={(e) => setFeedSource(e.target.value as 'device' | 'wifi')}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
            >
              <option value="device">Device Camera</option>
              <option value="wifi">Wi-Fi / IP Camera</option>
            </select>

            {(!cameraActive ||
              (feedSource === 'wifi' &&
                wifiCameras.find((c) => c.id === activeWifiCamId)?.kind === 'virtual-demo')) && (
              <select
                aria-label="Sample camera scene"
                value={activeSampleIdx}
                onChange={(e) => setActiveSampleIdx(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
              >
                {SAMPLE_SCENES.map((s, idx) => (
                  <option key={s.id} value={idx}>
                    Preview: {s.label}
                  </option>
                ))}
              </select>
            )}

            {feedSource === 'wifi' && (
              <>
                <select
                  value={activeWifiCamId}
                  onChange={(e) => setActiveWifiCamId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white max-w-[160px]"
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
                {wifiCameras.find((c) => c.id === activeWifiCamId)?.kind === 'http-snapshot' && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveWifiCamera(activeWifiCamId)}
                    className="p-1 text-red-400"
                    aria-label="Remove saved Wi-Fi camera"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}

            {cameraError && (
              <button
                type="button"
                onClick={startCamera}
                className="text-emerald-400 hover:text-emerald-300 font-medium ml-auto"
              >
                Retry Camera
              </button>
            )}
          </div>

          {showAddWifiForm && (
            <form onSubmit={handleAddWifiCamera} className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                value={newWifiName}
                onChange={(e) => setNewWifiName(e.target.value)}
                placeholder="Camera Name"
                className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white w-36"
              />
              <input
                type="url"
                required
                value={newWifiUrl}
                onChange={(e) => setNewWifiUrl(e.target.value)}
                placeholder="http://192.168.1.50:8080/shot.jpg"
                className="flex-1 min-w-[180px] px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
              />
              <button type="submit" className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold">
                Connect
              </button>
            </form>
          )}
        </div>
      )}

      {/* 2. Edge-to-Edge Live Viewfinder Stage (pure black framing, no extra bars) */}
      <div className="relative flex-1 min-h-[260px] bg-black flex items-center justify-center overflow-hidden">
        {mode === 'id-card' && idA4Preview ? (
          <div className="flex flex-col items-center justify-center gap-3 p-4 h-full w-full">
            <div className="relative bg-white rounded-md shadow-2xl p-1 max-h-[48vh] aspect-[210/297] flex items-center justify-center">
              <img
                src={idA4Preview}
                alt="1:1 A4 ID Card Preview"
                className="max-h-full max-w-full object-contain rounded-sm"
              />
              <span className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] px-2 py-0.5 rounded">
                A4 1:1
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {!idBack && idTemplate !== 'single' && idTemplate !== 'passport' && (
                <button
                  type="button"
                  onClick={() => setIdA4Preview(null)}
                  className="px-3.5 py-2 rounded-xl bg-white/15 text-xs font-semibold text-white"
                >
                  + Back Side
                </button>
              )}
              <button
                type="button"
                onClick={() => handleFinishIdCard(true)}
                disabled={savingBatch}
                className="px-6 py-2.5 rounded-xl bg-[#00995a] hover:bg-emerald-500 text-xs font-bold text-white shadow-lg"
              >
                {savingBatch ? 'Creating...' : 'Make it now'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIdFront(null);
                  setIdBack(null);
                  setIdA4Preview(null);
                }}
                className="px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
              <video
                ref={videoRef}
                playsInline
                muted
                style={flashMode === 'on' ? { filter: 'brightness(1.08)' } : undefined}
                className={`max-h-[68vh] w-full object-contain ${
                  feedSource === 'device' && cameraActive ? 'block' : 'hidden'
                }`}
              />
              <canvas
                ref={sampleCanvasRef}
                style={flashMode === 'on' ? { filter: 'brightness(1.08)' } : undefined}
                className={`max-h-[68vh] max-w-full object-contain ${
                  feedSource === 'device' && !cameraActive ? 'block' : 'hidden'
                }`}
              />
              <canvas
                ref={wifiCanvasRef}
                className={`max-h-[68vh] max-w-full object-contain ${
                  feedSource === 'wifi' ? 'block' : 'hidden'
                }`}
              />

              {/* 3x3 Alignment Grid */}
              {gridOverlay && (
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-white/15" />
                  ))}
                </div>
              )}

              {/* Live Automatic Green Paper-Edge Polygon */}
              {autoCropPaper && mode !== 'image' && mode !== 'qr-code' && (
                <svg
                  className="pointer-events-none absolute inset-0 w-full h-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  data-testid="paper-edge-overlay"
                >
                  <polygon
                    points={liveCorners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                    fill={paperDetected ? 'rgba(16, 185, 129, 0.14)' : 'transparent'}
                    stroke={paperDetected ? '#10b981' : 'transparent'}
                    strokeWidth="0.65"
                  />
                  {paperDetected &&
                    liveCorners.map((c, idx) => (
                      <circle
                        key={idx}
                        cx={c.x * 100}
                        cy={c.y * 100}
                        r="1.35"
                        fill="#10b981"
                        stroke="#ffffff"
                        strokeWidth="0.45"
                      />
                    ))}
                </svg>
              )}

              {/* Book Spine Center Line */}
              {mode === 'book' && (
                <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 border-l-2 border-dashed border-emerald-400/80" />
              )}

              {/* ID Card Frame Guide */}
              {mode === 'id-card' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-[78%] max-w-[300px] aspect-[85.6/53.98] border-2 border-emerald-400/90 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] flex items-end justify-center pb-2">
                    <span className="text-[11px] font-medium bg-black/75 text-emerald-300 px-2.5 py-0.5 rounded">
                      {!idFront ? 'Align Front Side' : 'Align Back Side'}
                    </span>
                  </div>
                </div>
              )}

              {/* QR Code Target Box */}
              {mode === 'qr-code' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-emerald-400 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
                </div>
              )}
            </div>
          </div>
        )}

        <canvas ref={analysisCanvasRef} className="hidden" />

        {/* Live Search -> Auto Document Selection -> Quick Capture Pill */}
        {!(mode === 'id-card' && idA4Preview) &&
          mode !== 'qr-code' &&
          mode !== 'id-card' &&
          autoCropPaper && (
            <>
              {!paperDetected && (
                <div className="pointer-events-none absolute top-[44%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-white/95 text-slate-900 px-5 py-2 rounded-full text-sm font-medium shadow-lg whitespace-nowrap">
                  Searching doc...
                </div>
              )}
              {paperDetected && (
                <button
                  type="button"
                  onClick={() => {
                    if (autoPausedAfterCapture) {
                      setAutoPausedAfterCapture(false);
                      lastAutoCaptureAtRef.current = 0;
                    } else {
                      setAutoEnabled((v) => !v);
                    }
                  }}
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-black/80 border border-emerald-400/60 text-white px-3.5 py-1.5 rounded-full text-xs font-medium shadow-lg flex items-center gap-2 whitespace-nowrap hover:bg-black transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      autoPhase === 'capturing'
                        ? 'bg-emerald-400 animate-ping'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span>
                    {autoPausedAfterCapture
                      ? 'Document selected · Tap for Quick Capture'
                      : autoEnabled
                      ? autoPhase === 'capturing'
                        ? 'Quick Capturing...'
                        : `Document selected · Quick capture (${lockProgressPct}%)`
                      : 'Document selected (Manual shutter)'}
                  </span>
                </button>
              )}
            </>
          )}

        {flashActive && <div className="absolute inset-0 bg-white/80 pointer-events-none z-30" />}

        {croppingBusy && (
          <div className="absolute inset-0 bg-black/45 flex items-center justify-center z-20">
            <div className="bg-white/95 text-slate-900 px-5 py-2 rounded-full text-xs font-semibold shadow-lg">
              Cropping paper...
            </div>
          </div>
        )}

        {(qrResult || extractedSnippet || statusBanner) && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-black/85 border border-white/15 text-white px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 max-w-[90%]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">
              {mode === 'qr-code' && qrResult
                ? qrResult
                : mode === 'to-text' && extractedSnippet
                ? extractedSnippet.slice(0, 80)
                : statusBanner}
            </span>
          </div>
        )}
      </div>

      {/* ID Card Sub-Template Pills (only in ID Card mode) */}
      {mode === 'id-card' && (
        <div className="px-4 py-2 bg-black flex items-center justify-center gap-2 shrink-0">
          {(
            [
              { id: 'single', label: 'Single Side' },
              { id: 'license', label: 'Driver License' },
              { id: 'passport', label: 'Passport' },
            ] as const
          ).map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setIdTemplate(tpl.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                idTemplate === tpl.id
                  ? 'bg-[#00995a] text-white'
                  : 'bg-white/10 text-slate-300'
              }`}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      )}

      {/* Batch & Book Strip (only when pages are queued) */}
      {(mode === 'batch' || mode === 'book') && batchPages.length > 0 && (
        <div className="px-4 py-2 bg-[#111317] border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto">
            {batchPages.map((pg, idx) => (
              <div key={idx} className="relative shrink-0 bg-slate-900 rounded p-0.5 border border-slate-700">
                <img src={pg} alt={`Page ${idx + 1}`} className="h-10 w-8 object-cover rounded-sm" />
                <div className="flex items-center justify-center gap-1 mt-0.5 text-[9px] text-slate-300">
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
                    aria-label="Move page left"
                  >
                    <ArrowLeft className="w-2.5 h-2.5" />
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
                    aria-label="Move page right"
                  >
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchPages((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Delete page"
                    className="text-red-400"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleFinishBatchToPdf}
            disabled={savingBatch}
            className="px-4 py-2 text-xs font-semibold bg-[#00995a] text-white rounded-full shrink-0"
          >
            {savingBatch ? 'Saving...' : `Save PDF (${batchPages.length})`}
          </button>
        </div>
      )}

      {/* 3. Exact 5-Mode Bar: Book · To Text · Docs · ID Card · QR Code */}
      <div className="px-3 pt-2.5 pb-1 bg-black flex items-center justify-center gap-1.5 sm:gap-3 overflow-x-auto shrink-0">
        {modeTabs.map((t) => {
          const active = activeModeForPill === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-mode={t.id}
              onClick={() => onModeChange(t.id)}
              className={`px-3.5 py-1 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                active ? 'bg-[#00995a] text-white font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 4. Exact Oken Bottom Shutter Deck:  ×  |  White Shutter  |  Import   Import Files */}
      <div className="px-6 pt-4 pb-6 bg-black flex items-center justify-between shrink-0">
        <div className="w-24 flex items-center justify-start">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Camera"
            className="w-11 h-11 flex items-center justify-center text-white hover:text-slate-300 active:scale-95 transition-transform"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void triggerCapture(false)}
          aria-label="Capture Scan"
          className="w-[70px] h-[70px] rounded-full border-[3px] border-white p-1.5 flex items-center justify-center active:scale-95 transition-transform shrink-0"
        >
          <span className="w-full h-full rounded-full bg-white block" />
        </button>

        <div className="w-28 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 text-white hover:text-slate-300 min-w-[44px]"
          >
            <ImageIcon className="w-5 h-5" />
            <span className="text-[11px] font-normal whitespace-nowrap">Import</span>
          </button>
          <button
            type="button"
            onClick={() => docImportInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 text-white hover:text-slate-300 min-w-[44px]"
          >
            <FileInput className="w-5 h-5" />
            <span className="text-[11px] font-normal whitespace-nowrap">Import Files</span>
          </button>
        </div>

        <input
          ref={docImportInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={handleGalleryFiles}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleGalleryFiles}
          className="hidden"
        />
      </div>
    </div>
  );
}
