import {
  ArrowRight,
  BookmarkPlus,
  Camera,
  Check,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  Server,
  Smartphone,
  Trash2,
  Unplug,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parsePcAddressInput,
  parseQrPairingPayload,
  type SavedPcAddress,
} from '../services/pcAddressMath';
import type { PairedDevice } from '../types';

interface DesktopPairingPanelProps {
  pairCode: string;
  wsConnected: boolean;
  devices: PairedDevice[];
  onRegenerateCode: () => Promise<void>;
  onRemoveDevice: (deviceId: string) => Promise<void>;
}

export function DesktopPairingPanel({
  pairCode,
  wsConnected,
  devices,
  onRegenerateCode,
  onRemoveDevice,
}: DesktopPairingPanelProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // When the app is opened as http://localhost, other devices cannot reach that address,
  // so ask the server for its Wi-Fi (LAN) address instead.
  const [lanOrigin, setLanOrigin] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return;
    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((d: { urls?: string[] }) => {
        if (d.urls && d.urls.length > 0) setLanOrigin(d.urls[0]);
      })
      .catch(() => undefined);
  }, []);

  const pairUrl =
    typeof window !== 'undefined' && pairCode
      ? `${lanOrigin || window.location.origin}/?pair=${pairCode}&mode=mobile`
      : '';

  useEffect(() => {
    if (!pairUrl) return;
    QRCode.toDataURL(pairUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [pairUrl]);

  const handleCopyLink = async () => {
    if (!pairUrl) return;
    await navigator.clipboard.writeText(pairUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `oklivo-scanner-pair-${pairCode || 'qr'}.png`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Mobile-to-PC Device Pairing</h2>
        <p className="text-sm text-slate-500">
          Scan this QR code inside Mobile &ldquo;Connect PC&rdquo; or enter the 6-digit code to sync scans automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR & Code Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="p-3 bg-white border border-slate-200 rounded-2xl shrink-0">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`Pairing QR for code ${pairCode}`} className="w-44 h-44" />
            ) : (
              <div className="w-44 h-44 bg-slate-100 rounded-xl flex items-center justify-center text-xs text-slate-400">
                Generating QR...
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div className="text-xs font-medium text-slate-500">
              Desktop Receiver Status ·{' '}
              <span className={wsConnected ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                {wsConnected ? 'Listening for Transfers' : 'Reconnecting...'}
              </span>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1">6-Digit Pairing Code</div>
              <div className="text-3xl font-mono font-bold tracking-widest tabular-nums text-slate-900">
                {pairCode || '------'}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
              {pairUrl && (
                <a
                  href={pairUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Paired Mobile Tab
                </a>
              )}
              {qrDataUrl && (
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download QR
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Link Copied' : 'Copy Link'}
              </button>
              <button
                type="button"
                onClick={onRegenerateCode}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100"
              >
                New Code
              </button>
            </div>
          </div>
        </div>

        {/* Paired Devices Registry */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Paired Mobile Devices ({devices.length})
            </h3>
            <span className="text-xs text-slate-500">Auto-reconnect enabled</span>
          </div>

          {devices.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Smartphone className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-600">No mobile device paired yet.</p>
              <p className="text-xs text-slate-400">
                Scan the QR code on your phone or click &ldquo;Open Paired Mobile Tab&rdquo; to test live transfers.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {devices.map((dev) => (
                <div key={dev.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{dev.name}</div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {dev.platform} ·{' '}
                        <span className={dev.connected ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                          {dev.connected ? 'Connected' : 'Offline'}
                        </span>{' '}
                        · Last seen {new Date(dev.lastSeen).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveDevice(dev.id)}
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                    aria-label={`Remove ${dev.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MobileConnectPanelProps {
  currentPairCode: string;
  wsConnected: boolean;
  desktopOnline: boolean;
  deviceName: string;
  savedPcAddresses: SavedPcAddress[];
  selectedPcId: string;
  onDeviceNameChange: (name: string) => void;
  onSavePcAddress: (address: string, pairCode?: string) => Promise<SavedPcAddress | null>;
  onSelectPcAddress: (pc: SavedPcAddress) => Promise<void>;
  onDeletePcAddress: (id: string) => Promise<void>;
  onPairWithCode: (code: string, pcAddress?: string) => Promise<boolean>;
  onDisconnect: () => void;
  onSkip?: () => void;
}

export function MobileConnectPanel({
  currentPairCode,
  wsConnected,
  desktopOnline,
  deviceName,
  savedPcAddresses,
  selectedPcId,
  onDeviceNameChange,
  onSavePcAddress,
  onSelectPcAddress,
  onDeletePcAddress,
  onPairWithCode,
  onDisconnect,
  onSkip,
}: MobileConnectPanelProps) {
  const selectedPc =
    savedPcAddresses.find((p) => p.id === selectedPcId) || savedPcAddresses[0] || null;

  const [pcAddressInput, setPcAddressInput] = useState(
    selectedPc?.address || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [inputCode, setInputCode] = useState(currentPairCode || selectedPc?.pairCode || '');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // QR Scanner modal / embedded panel state
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrCamError, setQrCamError] = useState('');
  const [qrCamReady, setQrCamReady] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement | null>(null);
  const decodingQrRef = useRef(false);

  // Keep inputs synced when user selects a saved PC or boots IndexedDB
  useEffect(() => {
    const match = savedPcAddresses.find((p) => p.id === selectedPcId);
    if (match) {
      setPcAddressInput(match.address);
      if (match.pairCode) setInputCode(match.pairCode);
    }
  }, [selectedPcId, savedPcAddresses]);

  const stopQrCamera = useCallback(() => {
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((t) => t.stop());
      qrStreamRef.current = null;
    }
    setQrCamReady(false);
  }, []);

  const handleDecodedQrText = useCallback(
    async (rawText: string) => {
      if (decodingQrRef.current) return;
      const payload = parseQrPairingPayload(rawText);
      if (!payload) {
        setError('Scanned QR code is not a valid Oklivo PC pairing QR.');
        return;
      }

      decodingQrRef.current = true;
      stopQrCamera();
      setShowQrScanner(false);
      setError('');
      setNotice('');

      try {
        const resolvedAddress =
          payload.address ||
          pcAddressInput ||
          (typeof window !== 'undefined' ? window.location.origin : '');
        const resolvedCode = (payload.pairCode || inputCode).replace(/\D/g, '').slice(0, 6);

        if (resolvedAddress) setPcAddressInput(resolvedAddress);
        if (resolvedCode) setInputCode(resolvedCode);

        const saved = resolvedAddress
          ? await onSavePcAddress(resolvedAddress, resolvedCode || undefined)
          : null;
        if (saved) setPcAddressInput(saved.address);

        if (resolvedCode.length === 6) {
          setJoining(true);
          try {
            const ok = await onPairWithCode(
              resolvedCode,
              saved?.address || resolvedAddress || undefined
            );
            if (ok) {
              setNotice(`Paired via QR with ${saved?.displayHost || 'PC'} (${resolvedCode}).`);
              onSkip?.();
            } else {
              setError(
                'QR scanned & PC address saved, but desktop channel is unreachable right now.'
              );
            }
          } finally {
            setJoining(false);
          }
        } else {
          setNotice(
            `Saved "${saved?.displayHost || resolvedAddress}" from QR. Enter 6-digit code to pair.`
          );
        }
      } finally {
        decodingQrRef.current = false;
      }
    },
    [inputCode, onPairWithCode, onSavePcAddress, onSkip, pcAddressInput, stopQrCamera]
  );

  // Start / poll live camera when QR scanner box is open
  useEffect(() => {
    if (!showQrScanner) {
      stopQrCamera();
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setQrCamError('');

    const initCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setQrCamError('Live camera unavailable — upload a QR photo below.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        qrStreamRef.current = stream;
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = stream;
          await qrVideoRef.current.play();
          setQrCamReady(true);
        }

        const scanFrame = () => {
          if (cancelled) return;
          const video = qrVideoRef.current;
          const canvas = qrCanvasRef.current;
          if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
            const w = Math.min(640, video.videoWidth);
            const h = Math.round((video.videoHeight / video.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const hit = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
              if (hit?.data) {
                void handleDecodedQrText(hit.data);
                return;
              }
            }
          }
          timer = window.setTimeout(scanFrame, 220);
        };
        timer = window.setTimeout(scanFrame, 250);
      } catch {
        if (!cancelled) {
          setQrCamError('Camera permission denied — upload a QR screenshot/photo below.');
        }
      }
    };

    void initCamera();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stopQrCamera();
    };
  }, [handleDecodedQrText, showQrScanner, stopQrCamera]);

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setNotice('');

    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
      });

      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // White backdrop helps PNG QR screenshots with transparency
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const imgData = ctx.getImageData(0, 0, w, h);
      const hit = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) {
        await handleDecodedQrText(hit.data);
        return;
      }

      // Optional native BarcodeDetector fallback if jsQR missed angled crop
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;
      if (Detector) {
        const det = new Detector({ formats: ['qr_code'] });
        const found = await det.detect(img);
        if (found[0]?.rawValue) {
          await handleDecodedQrText(found[0].rawValue);
          return;
        }
      }

      setError('Could not read a QR code from that photo. Ensure the full QR square is clear.');
    } catch {
      setError('Could not read that image file.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handleAddressChange = (val: string) => {
    setPcAddressInput(val);
    const parsed = parsePcAddressInput(val);
    if (parsed?.pairCode) {
      setInputCode(parsed.pairCode);
    }
  };

  const handleSaveAddressOnly = async () => {
    setError('');
    setNotice('');
    const parsed = parsePcAddressInput(pcAddressInput, inputCode);
    if (!parsed) {
      setError('Enter a valid PC IP or URL (e.g. 192.168.1.25:3000).');
      return;
    }
    const saved = await onSavePcAddress(pcAddressInput, inputCode);
    if (saved) {
      setPcAddressInput(saved.address);
      setNotice(`Saved "${saved.displayHost}" to PC list.`);
    }
  };

  const handleSelectSavedPc = async (pc: SavedPcAddress) => {
    setError('');
    setNotice('');
    setPcAddressInput(pc.address);
    if (pc.pairCode) setInputCode(pc.pairCode);
    await onSelectPcAddress(pc);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const parsed = parsePcAddressInput(pcAddressInput, inputCode);
    const cleaned = (parsed?.pairCode || inputCode).replace(/\D/g, '').slice(0, 6);

    // Always persist entered PC address so user never has to re-type it
    if (parsed) {
      const saved = await onSavePcAddress(pcAddressInput, cleaned || undefined);
      if (saved) setPcAddressInput(saved.address);
    }

    if (cleaned.length !== 6) {
      setError(
        parsed
          ? `Address "${parsed.displayHost}" saved. Enter the 6-digit pairing code, Scan QR, or tap Skip.`
          : 'Enter PC address & 6-digit pairing code from your Desktop screen.'
      );
      return;
    }

    setJoining(true);
    try {
      const ok = await onPairWithCode(cleaned, parsed?.address || pcAddressInput);
      if (!ok) {
        setError('Could not reach pairing channel. Address is saved — check PC code or tap Skip.');
      } else {
        onSkip?.();
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 p-1"
              aria-hidden="true"
            >
              <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="pcScreenGrad" x1="6" y1="8" x2="34" y2="28" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7DD3FC" />
                    <stop offset="100%" stopColor="#0284C7" />
                  </linearGradient>
                </defs>
                {/* Monitor Frame */}
                <rect x="4" y="8" width="28" height="21" rx="2.5" fill="#334155" />
                <rect x="6" y="10" width="24" height="15.5" rx="1.2" fill="url(#pcScreenGrad)" />
                {/* Screen Glare */}
                <path d="M7 11h11l-7 13H7V11z" fill="#FFFFFF" fillOpacity="0.24" />
                {/* Monitor Stand */}
                <rect x="15.5" y="29" width="5" height="5" fill="#64748B" />
                <rect x="11" y="34" width="14" height="2.8" rx="1.4" fill="#475569" />
                {/* Desktop CPU Tower */}
                <rect x="34" y="10" width="10" height="27" rx="2" fill="#E2E8F0" stroke="#475569" strokeWidth="1.6" />
                <rect x="36.2" y="13.5" width="5.6" height="2.2" rx="1" fill="#64748B" />
                <rect x="36.2" y="17.5" width="5.6" height="2.2" rx="1" fill="#94A3B8" />
                <circle cx="39" cy="31.5" r="1.6" fill="#0284C7" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-display font-bold text-slate-900">Connect PC</h2>
              <p className="text-xs text-slate-500">
                {currentPairCode && wsConnected
                  ? `Paired to channel ${currentPairCode} · ${desktopOnline ? 'PC Online' : 'Waiting for PC'}`
                  : 'Pair via QR code, 6-digit code, or saved PC'}
              </p>
            </div>
          </div>

          {!(currentPairCode && wsConnected) && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setNotice('');
                setShowQrScanner((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-colors shrink-0 min-h-[38px] ${
                showQrScanner
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-800'
              }`}
              aria-expanded={showQrScanner}
            >
              {showQrScanner ? <X className="w-3.5 h-3.5" /> : <QrCode className="w-3.5 h-3.5" />}
              {showQrScanner ? 'Close QR' : 'Scan QR'}
            </button>
          )}
        </div>

        {/* Embedded QR Scanner Panel (Live Camera + Upload QR Photo) */}
        {showQrScanner && !(currentPairCode && wsConnected) && (
          <div className="rounded-xl border border-slate-200 bg-slate-950 text-white p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold flex items-center gap-1.5 min-w-0 truncate">
                <Camera className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">Scan PC Pairing QR</span>
              </span>
              <button
                type="button"
                onClick={() => qrFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload QR
              </button>
            </div>

            <input
              ref={qrFileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleQrImageUpload(e)}
              className="hidden"
              aria-label="Upload QR code photo"
            />
            <canvas ref={qrCanvasRef} className="hidden" />

            <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video max-h-52 w-full flex items-center justify-center">
              <video
                ref={qrVideoRef}
                playsInline
                muted
                className={`w-full h-full object-cover ${qrCamReady ? 'block' : 'hidden'}`}
              />
              {qrCamReady ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-36 h-36 border-2 border-sky-400 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                </div>
              ) : (
                <div className="px-4 text-center space-y-2">
                  <QrCode className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-300">
                    {qrCamError || 'Starting camera to scan Desktop QR...'}
                  </p>
                  <button
                    type="button"
                    onClick={() => qrFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Select QR Image
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active connection card when paired */}
        {currentPairCode && wsConnected ? (
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Wifi className="w-4 h-4 text-emerald-700 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-emerald-950 font-mono tabular-nums truncate">
                    Channel {currentPairCode}
                  </div>
                  <div className="text-xs text-emerald-800 truncate">
                    {desktopOnline ? 'PC Connected — Auto-transfer active' : 'PC Standby — Scans queue safely'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-xl min-h-[38px] shrink-0"
              >
                <Unplug className="w-3.5 h-3.5" />
                Unpair
              </button>
            </div>
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="w-full py-3 px-4 bg-[#0d8a4b] hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl min-h-[44px] inline-flex items-center justify-center gap-2"
              >
                Continue to Scanner
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* PC Address input + Save button */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="pc-address-input" className="text-xs font-medium text-slate-700">
                  PC Address (IP or URL)
                </label>
                {typeof window !== 'undefined' && pcAddressInput !== window.location.origin && (
                  <button
                    type="button"
                    onClick={() => handleAddressChange(window.location.origin)}
                    className="text-[11px] font-medium text-[#0d8a4b] hover:underline"
                  >
                    Use Current Host
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="pc-address-input"
                  type="text"
                  value={pcAddressInput}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  placeholder="192.168.1.25:3000 or http://..."
                  className="flex-1 min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveAddressOnly()}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 rounded-xl shrink-0 min-h-[42px]"
                  aria-label="Save PC Address"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  Save
                </button>
              </div>
            </div>

            {/* 6-Digit Pairing Code */}
            <label className="block text-xs font-medium text-slate-700">
              6-Digit Pairing Code from PC
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 482910"
                className="mt-1 w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-base font-mono tracking-widest tabular-nums bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </label>

            {/* Mobile Device Name */}
            <label className="block text-xs font-medium text-slate-700">
              Mobile Device Name
              <input
                type="text"
                value={deviceName}
                onChange={(e) => onDeviceNameChange(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white"
              />
            </label>

            {notice && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
                {notice}
              </div>
            )}
            {error && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="submit"
                disabled={joining}
                className="flex-1 py-3 px-4 bg-[#0d8a4b] hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl min-h-[44px] shadow-sm transition-colors disabled:opacity-60"
              >
                {joining ? 'Connecting...' : 'Connect PC'}
              </button>
              {onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="px-4 py-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[44px] shrink-0 transition-colors"
                >
                  Skip
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Saved PC Addresses Selectable List */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Saved PC Addresses ({savedPcAddresses.length})
          </h3>
          {savedPcAddresses.length > 0 && (
            <span className="text-[11px] text-slate-400">Tap to select</span>
          )}
        </div>

        {savedPcAddresses.length === 0 ? (
          <div className="py-5 text-center space-y-1.5 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <Server className="w-6 h-6 text-slate-300 mx-auto" />
            <p className="text-xs text-slate-500">
              No saved PC addresses yet. Enter an address above and tap Save or Connect PC.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {savedPcAddresses.map((pc) => {
              const isSelected = pc.id === (selectedPc?.id || selectedPcId);
              return (
                <div
                  key={pc.id}
                  className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-emerald-50/70 border-emerald-500'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectSavedPc(pc)}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                    aria-label={`Select PC ${pc.displayHost}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#0d8a4b] text-white' : 'bg-white border border-slate-200 text-slate-500'
                      }`}
                    >
                      {isSelected ? <Check className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate font-mono">
                        {pc.displayHost}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                        <span className="truncate">{pc.address}</span>
                        {pc.pairCode && (
                          <span className="px-1.5 py-0.2 bg-white border border-slate-200 rounded font-mono text-[10px] text-emerald-800 shrink-0">
                            {pc.pairCode}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => void onDeletePcAddress(pc.id)}
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
                    aria-label={`Delete PC ${pc.displayHost}`}
                    title="Remove saved PC"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

