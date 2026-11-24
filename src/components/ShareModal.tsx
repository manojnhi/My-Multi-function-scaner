import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  Mail,
  MessageCircle,
  QrCode,
  Send,
  Share2,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { formatBytes } from '../services/db';
import { downloadDataUrl } from '../services/pdfService';
import { apiCreateShareLink } from '../services/syncClient';
import type { ScanDocument } from '../types';

interface ShareModalProps {
  document: ScanDocument;
  pairCode: string;
  wsConnected: boolean;
  isOffline: boolean;
  onSendViaLan?: (doc: ScanDocument) => void;
  onClose: () => void;
}

export function ShareModal({
  document: doc,
  pairCode,
  wsConnected,
  isOffline,
  onSendViaLan,
  onClose,
}: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    let active = true;
    if (isOffline) return;
    setCreatingLink(true);
    apiCreateShareLink({
      title: doc.title,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      dataUrl: doc.dataUrl,
    })
      .then(async (res) => {
        if (!active) return;
        setShareUrl(res.shareUrl);
        const qr = await QRCode.toDataURL(res.shareUrl, {
          width: 196,
          margin: 1,
          color: { dark: '#064e3b', light: '#ffffff' },
        });
        if (active) setQrDataUrl(qr);
      })
      .catch(() => {
        if (active) setStatusMsg('Offline mode: use Native Share, Email, or Download File.');
      })
      .finally(() => {
        if (active) setCreatingLink(false);
      });
    return () => {
      active = false;
    };
  }, [doc, isOffline]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      setStatusMsg('Clipboard permission unavailable.');
    }
  };

  const handleNativeSystemShare = async () => {
    try {
      const response = await fetch(doc.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], doc.fileName, { type: doc.mimeType });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: doc.title,
          text: `${doc.title} — scanned with My Multi Functional Scanner`,
          files: [file],
        });
        setStatusMsg('Shared via system share sheet.');
      } else if (navigator.share) {
        await navigator.share({
          title: doc.title,
          text: `${doc.title}${shareUrl ? ` — Download: ${shareUrl}` : ''}`,
          url: shareUrl || undefined,
        });
        setStatusMsg('Shared link via system share sheet.');
      } else {
        setStatusMsg('System share sheet is unavailable in this desktop browser — use WhatsApp, Telegram, QR, or Download.');
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setStatusMsg('Share cancelled or unsupported on this device.');
      }
    }
  };

  const shareText = encodeURIComponent(
    `${doc.title} (${doc.fileName})${shareUrl ? `\nDownload: ${shareUrl}` : ''}`
  );
  const whatsappHref = `https://wa.me/?text=${shareText}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(
    shareUrl || window.location.href
  )}&text=${encodeURIComponent(doc.title)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent(
    doc.title
  )}&body=${shareText}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share Document Across All Platforms"
    >
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Share2 className="w-4 h-4 text-emerald-700" />
              Share Across All Platforms
            </h2>
            <p className="text-xs text-slate-500 truncate mt-0.5 tabular-nums">
              {doc.fileName} · {formatBytes(doc.sizeBytes)} · {doc.mimeType === 'application/pdf' ? 'PDF' : 'Image'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            aria-label="Close share dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Primary Native OS Share & LAN Transfer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleNativeSystemShare}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              <Share2 className="w-4 h-4" />
              System Share Sheet (Android / iOS / Win / Mac)
            </button>

            {onSendViaLan && (
              <button
                type="button"
                disabled={!pairCode || !wsConnected}
                onClick={() => {
                  onSendViaLan(doc);
                  setStatusMsg(`Sent "${doc.title}" over LAN channel (${pairCode}).`);
                }}
                className="inline-flex items-center justify-center gap-2 py-2.5 px-4 border border-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-xs font-semibold rounded-xl disabled:opacity-50"
              >
                <Laptop className="w-4 h-4" />
                {wsConnected && pairCode ? `Send to Paired PC (${pairCode})` : 'LAN Transfer (Not Paired)'}
              </button>
            )}
          </div>

          {/* Direct Cross-Platform App Targets */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Direct App & Web Targets</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 text-xs font-medium text-slate-800 transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-emerald-700" />
                <span>WhatsApp</span>
              </a>
              <a
                href={telegramHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 text-xs font-medium text-slate-800 transition-colors"
              >
                <Send className="w-4 h-4 text-sky-600" />
                <span>Telegram</span>
              </a>
              <a
                href={emailHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 text-xs font-medium text-slate-800 transition-colors"
              >
                <Mail className="w-4 h-4 text-slate-700" />
                <span>Email</span>
              </a>
              <button
                type="button"
                onClick={() => downloadDataUrl(doc.dataUrl, doc.fileName)}
                className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 text-xs font-medium text-slate-800 transition-colors"
              >
                <Download className="w-4 h-4 text-emerald-800" />
                <span>Download File</span>
              </button>
            </div>
          </div>

          {/* QR Code + Shareable Cross-Device Link */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-32 h-32 bg-white rounded-xl border border-slate-200 flex items-center justify-center shrink-0 p-2">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Scan QR to download document" className="w-full h-full object-contain" />
              ) : (
                <QrCode className="w-8 h-8 text-slate-300" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2.5 w-full">
              <div className="text-xs font-semibold text-slate-900">
                Cross-Platform Direct Link & QR (iOS, Android, Windows, macOS, Linux)
              </div>
              <p className="text-xs text-slate-500">
                {creatingLink
                  ? 'Generating 24-hour encrypted download URL...'
                  : shareUrl
                  ? 'Scan QR or copy link to open this exact file on any browser or device.'
                  : 'Connect online to generate a cross-device download link.'}
              </p>
              {shareUrl && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(shareUrl, 'link')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-lg shrink-0"
                  >
                    {copiedKey === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'link' ? 'Copied' : 'Copy'}
                  </button>
                  <a
                    href={`${shareUrl}?download=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 border border-slate-200 bg-white rounded-lg hover:bg-slate-100 text-slate-700"
                    title="Open link"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
              {doc.ocrText && (
                <button
                  type="button"
                  onClick={() => handleCopy(doc.ocrText, 'ocr')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 hover:underline"
                >
                  <Copy className="w-3 h-3" />
                  {copiedKey === 'ocr' ? 'OCR Text Copied!' : 'Copy Extracted OCR Text'}
                </button>
              )}
            </div>
          </div>

          {statusMsg && (
            <div className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
