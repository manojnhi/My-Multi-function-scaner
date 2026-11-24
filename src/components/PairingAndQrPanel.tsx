import { Check, Copy, ExternalLink, Laptop, Smartphone, Trash2, Unplug, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
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

  const pairUrl =
    typeof window !== 'undefined' && pairCode
      ? `${window.location.origin}/?pair=${pairCode}&mode=mobile`
      : '';

  useEffect(() => {
    if (!pairUrl) return;
    QRCode.toDataURL(pairUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#064E3B', light: '#FFFFFF' },
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Mobile-to-PC Device Pairing</h2>
        <p className="text-sm text-slate-500">
          Pair your Android or mobile browser to automatically receive every captured scan without pressing Share.
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
              <div className="text-3xl font-mono font-bold tracking-widest tabular-nums text-emerald-950">
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
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
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
  onDeviceNameChange: (name: string) => void;
  onPairWithCode: (code: string) => Promise<boolean>;
  onDisconnect: () => void;
}

export function MobileConnectPanel({
  currentPairCode,
  wsConnected,
  desktopOnline,
  deviceName,
  onDeviceNameChange,
  onPairWithCode,
  onDisconnect,
}: MobileConnectPanelProps) {
  const [inputCode, setInputCode] = useState(currentPairCode || '');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inputCode.replace(/\D/g, '').slice(0, 6);
    if (cleaned.length !== 6) {
      setError('Enter the 6-digit pairing code shown on your Windows Desktop screen.');
      return;
    }
    setJoining(true);
    setError('');
    try {
      const ok = await onPairWithCode(cleaned);
      if (!ok) {
        setError('Pairing code not found. Verify the code on your Windows Desktop app.');
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Connect to Windows PC</h3>
            <p className="text-xs text-slate-500">
              {currentPairCode && wsConnected
                ? `Paired to channel ${currentPairCode} · ${desktopOnline ? 'Desktop Online' : 'Waiting for Desktop'}`
                : 'Pair once to auto-transfer every scan over local network or relay.'}
            </p>
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-700">
          This Mobile Device Name
          <input
            type="text"
            value={deviceName}
            onChange={(e) => onDeviceNameChange(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
          />
        </label>

        {currentPairCode && wsConnected ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Wifi className="w-4 h-4 text-emerald-700" />
              <div>
                <div className="text-sm font-semibold text-emerald-950 font-mono tabular-nums">
                  Channel {currentPairCode}
                </div>
                <div className="text-xs text-emerald-800">
                  {desktopOnline ? 'PC Connected — Auto-transfer active' : 'PC Offline — Scans queue safely'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-xl min-h-[40px]"
            >
              <Unplug className="w-3.5 h-3.5" />
              Unpair
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs font-medium text-slate-700">
              Enter 6-Digit Pairing Code from PC
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 482910"
                className="mt-1 w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-mono tracking-widest tabular-nums"
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={joining}
              className="w-full py-3 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold rounded-xl min-h-[44px]"
            >
              {joining ? 'Connecting...' : 'Pair & Connect PC'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
