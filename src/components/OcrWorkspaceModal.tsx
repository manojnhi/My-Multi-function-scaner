import { Check, Copy, Download, Languages, Loader2, Play, X } from 'lucide-react';
import { useState } from 'react';
import { downloadTextFile, runOcrExtraction } from '../services/ocrService';
import type { OcrLanguage, ScanDocument } from '../types';

interface OcrWorkspaceModalProps {
  document: ScanDocument;
  onClose: () => void;
  onSaveOcr: (docId: string, text: string, lang: OcrLanguage) => Promise<void>;
}

export function OcrWorkspaceModal({ document: doc, onClose, onSaveOcr }: OcrWorkspaceModalProps) {
  const [lang, setLang] = useState<OcrLanguage>(doc.ocrLanguage || 'eng+hin');
  const [text, setText] = useState(doc.ocrText || '');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleRunOcr = async () => {
    if (doc.mimeType === 'application/pdf') {
      setError('Convert PDF pages to images in PDF Tools first, or run OCR on an image scan.');
      return;
    }
    setRunning(true);
    setError('');
    setSaved(false);
    setProgress(5);
    try {
      const res = await runOcrExtraction(doc.dataUrl, lang, (pct, status) => {
        setProgress(pct);
        setStatusMsg(status);
      });
      setText(res.text || '(No legible text detected in frame)');
      setConfidence(res.confidence);
      await onSaveOcr(doc.id, res.text, lang);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (Offline OCR requires cached language data from a previous online run.)`
          : 'OCR processing failed.'
      );
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleSaveManualEdits = async () => {
    await onSaveOcr(doc.id, text, lang);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="OCR Text Recognition"
    >
      <div className="w-full max-w-5xl h-[86vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">OCR Text Recognition</h2>
            <p className="text-xs text-slate-500">
              {doc.title} · Offline-capable Hindi & English text extraction
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            aria-label="Close OCR window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
          {/* Source Image */}
          <div className="bg-slate-100 p-4 flex items-center justify-center overflow-auto border-b lg:border-b-0 lg:border-r border-slate-200">
            {doc.mimeType === 'application/pdf' ? (
              <div className="text-center p-6 text-sm text-slate-600">
                PDF document selected. Use PDF Tools → PDF to Images to extract pages for OCR.
              </div>
            ) : (
              <img
                src={doc.dataUrl}
                alt={doc.title}
                className="max-h-full w-auto object-contain rounded-lg border border-slate-200 bg-white"
              />
            )}
          </div>

          {/* Text Extraction Panel */}
          <div className="flex flex-col p-4 min-h-0 bg-white">
            <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
                <Languages className="w-4 h-4 text-emerald-700" />
                <span>Language:</span>
              </div>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as OcrLanguage)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-800"
              >
                <option value="eng">English (eng)</option>
                <option value="hin">Hindi / हिन्दी (hin)</option>
                <option value="eng+hin">English + Hindi (eng+hin)</option>
              </select>

              <button
                type="button"
                onClick={handleRunOcr}
                disabled={running}
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg disabled:opacity-60"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {running ? `Extracting ${progress}%` : 'Run OCR'}
              </button>
            </div>

            {running && (
              <div className="py-2">
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{statusMsg}</p>
              </div>
            )}

            {error && (
              <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Click 'Run OCR' to extract English or Hindi text from this scan. You can edit the recognized text directly here."
              className="flex-1 w-full mt-3 p-3 text-sm leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-slate-100">
              <div className="text-xs text-slate-500 tabular-nums">
                {text.length} chars {confidence !== null ? `· ${confidence}% confidence` : ''}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!text}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadTextFile(text, doc.fileName)}
                  disabled={!text}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export .TXT
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualEdits}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-lg hover:bg-emerald-900"
                >
                  {saved ? 'Saved to Index' : 'Save Text'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
