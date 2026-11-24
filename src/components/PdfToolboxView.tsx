import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Crop,
  FileDown,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Loader2,
  Lock,
  Minimize2,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  Stamp,
  Trash2,
  Type,
  Unlock,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../services/db';
import {
  addWatermarkToPdf,
  applyPdfTextEdits,
  cleanPdfDocument,
  compressPdfViaRasterize,
  cropPdfPages,
  decryptDocumentVault,
  downloadDataUrl,
  encryptDocumentVault,
  extractPdfPages,
  extractPdfTextItems,
  imagesToPdf,
  mergePdfs,
  pdfToImages,
  protectPdfWithPassword,
  rebuildPdfPages,
  removePdfPassword,
  resizePdfToManualSize,
  rotatePdfAllOrSelected,
  type ExtractedPdfTextSpan,
  type PdfTextAnnotation,
} from '../services/pdfService';
import type { DocumentCategory, DocumentFilterMode, PaperSize, ScanDocument } from '../types';

interface PdfToolboxViewProps {
  documents: ScanDocument[];
  onSaveGeneratedDocument: (params: {
    dataUrl: string;
    title: string;
    category: DocumentCategory;
    mimeType: string;
    fileExtension: string;
    pageCount: number;
  }) => Promise<void>;
}

type PdfToolTab =
  | 'img-to-pdf'
  | 'text-editor'
  | 'crop-resize'
  | 'clean-pdf'
  | 'password'
  | 'organize'
  | 'merge'
  | 'split'
  | 'rotate-compress'
  | 'watermark'
  | 'pdf-to-img';

interface OrganizedPageItem {
  zeroBasedIndex: number;
  thumb: string;
  rotationDelta: 0 | 90 | 180 | 270;
}

export function PdfToolboxView({ documents, onSaveGeneratedDocument }: PdfToolboxViewProps) {
  const [activeTab, setActiveTab] = useState<PdfToolTab>('img-to-pdf');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [singlePdfId, setSinglePdfId] = useState<string>('');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [marginPt, setMarginPt] = useState(24);
  const [quality, setQuality] = useState(0.88);
  const [outputName, setOutputName] = useState('Compiled_Document');
  const [pageRangeInput, setPageRangeInput] = useState('1');
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);

  // Organize pages state
  const [organizedPages, setOrganizedPages] = useState<OrganizedPageItem[]>([]);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  // PDF Text Editor state
  const [editorPageImgs, setEditorPageImgs] = useState<string[]>([]);
  const [editorPageIdx, setEditorPageIdx] = useState(0);
  const [editorZoom, setEditorZoom] = useState(1);
  const [extractedSpans, setExtractedSpans] = useState<ExtractedPdfTextSpan[]>([]);
  const [textEdits, setTextEdits] = useState<PdfTextAnnotation[]>([]);
  const [draftText, setDraftText] = useState('Approved Copy');
  const [draftFontSize, setDraftFontSize] = useState(14);
  const [draftColor, setDraftColor] = useState('#0f172a');
  const [draftBold, setDraftBold] = useState(false);
  const [draftWhiteout, setDraftWhiteout] = useState(true);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const editorStageRef = useRef<HTMLDivElement | null>(null);

  // Clean PDF state
  const [cleanStrength, setCleanStrength] = useState(82);
  const [cleanMode, setCleanMode] = useState<DocumentFilterMode>('color');
  const [cleanQuality, setCleanQuality] = useState(0.86);

  // PDF Password Make & Remove state
  const [protectPassword, setProtectPassword] = useState('');
  const [protectOwnerPassword, setProtectOwnerPassword] = useState('');
  const [unlockPdfPassword, setUnlockPdfPassword] = useState('');
  const [uploadedLockedPdf, setUploadedLockedPdf] = useState<{ name: string; dataUrl: string } | null>(null);
  const lockedPdfInputRef = useRef<HTMLInputElement | null>(null);

  // Watermark state
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  const [watermarkDiagonal, setWatermarkDiagonal] = useState(true);
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.24);

  // Password Vault (.mfsvault) state
  const [vaultDocId, setVaultDocId] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const vaultFileInputRef = useRef<HTMLInputElement | null>(null);

  // PDF Crop & Manual Size Feed state
  const [pdfCropRect, setPdfCropRect] = useState({ x: 0.06, y: 0.06, width: 0.88, height: 0.88 });
  const [pdfCropApplyAll, setPdfCropApplyAll] = useState(true);
  const [pdfTargetVal, setPdfTargetVal] = useState('250');
  const [pdfTargetUnit, setPdfTargetUnit] = useState<'KB' | 'MB'>('KB');
  const pdfCropDragRef = useRef<{
    type: 'move' | 'handle';
    handle?: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
    startX: number;
    startY: number;
    orig: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const pdfCropStageRef = useRef<HTMLDivElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const imageDocs = documents.filter((d) => d.mimeType.startsWith('image/'));
  const pdfDocs = documents.filter((d) => d.mimeType === 'application/pdf');

  // Load thumbnails when Organize Pages tab has a PDF selected
  useEffect(() => {
    if (activeTab !== 'organize' || !singlePdfId) {
      setOrganizedPages([]);
      return;
    }
    const target = pdfDocs.find((p) => p.id === singlePdfId);
    if (!target) return;
    let active = true;
    setLoadingThumbs(true);
    pdfToImages(target.dataUrl, 0.7, 0.72)
      .then((thumbs) => {
        if (!active) return;
        setOrganizedPages(
          thumbs.map((thumb, idx) => ({
            zeroBasedIndex: idx,
            thumb,
            rotationDelta: 0,
          }))
        );
      })
      .catch(() => {
        if (active) setOrganizedPages([]);
      })
      .finally(() => {
        if (active) setLoadingThumbs(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, singlePdfId, pdfDocs]);

  // Load page images & selectable text spans when PDF Text Editor or Crop & Resize tab has a PDF selected
  useEffect(() => {
    if ((activeTab !== 'text-editor' && activeTab !== 'crop-resize') || !singlePdfId) {
      setEditorPageImgs([]);
      setExtractedSpans([]);
      setTextEdits([]);
      setEditorPageIdx(0);
      return;
    }
    const target = pdfDocs.find((p) => p.id === singlePdfId);
    if (!target) return;
    let active = true;
    setLoadingEditor(true);
    const loadSpans = activeTab === 'text-editor' ? extractPdfTextItems(target.dataUrl) : Promise.resolve([]);
    Promise.all([pdfToImages(target.dataUrl, 1.4, 0.88), loadSpans])
      .then(([imgs, spans]) => {
        if (!active) return;
        setEditorPageImgs(imgs);
        setExtractedSpans(spans);
        setEditorPageIdx(0);
        setTextEdits([]);
      })
      .catch(() => {
        if (active) {
          setEditorPageImgs([]);
          setExtractedSpans([]);
          setFeedback('Could not render PDF pages (if password-protected, unlock it in PDF Password tab first).');
        }
      })
      .finally(() => {
        if (active) setLoadingEditor(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, singlePdfId, pdfDocs]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleUploadLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
        await onSaveGeneratedDocument({
          dataUrl,
          title: f.name.replace(/\.[^.]+$/, ''),
          category: isPdf ? 'PDFs' : 'Imported',
          mimeType: isPdf ? 'application/pdf' : f.type || 'image/jpeg',
          fileExtension: isPdf ? 'pdf' : f.name.split('.').pop() || 'jpg',
          pageCount: 1,
        });
        setFeedback(`Added ${f.name} to library.`);
      };
      reader.readAsDataURL(f);
    }
    e.target.value = '';
  };

  const handleImagesToPdf = async () => {
    const chosen = imageDocs.filter((d) => selectedIds.includes(d.id));
    if (chosen.length === 0) return;
    setBusy(true);
    setFeedback('');
    try {
      const result = await imagesToPdf(
        chosen.map((c) => c.dataUrl),
        { paperSize, orientation, marginPt, quality }
      );
      await onSaveGeneratedDocument({
        dataUrl: result.dataUrl,
        title: outputName.trim() || 'Compiled_Document',
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: result.pageCount,
      });
      setSelectedIds([]);
      setFeedback(`Created ${outputName}.pdf (${result.pageCount} pages, ${formatBytes(result.sizeBytes)}).`);
    } finally {
      setBusy(false);
    }
  };

  const handleMergePdfs = async () => {
    const chosen = pdfDocs.filter((d) => selectedIds.includes(d.id));
    if (chosen.length < 2) return;
    setBusy(true);
    setFeedback('');
    try {
      const merged = await mergePdfs(chosen.map((c) => c.dataUrl));
      await onSaveGeneratedDocument({
        dataUrl: merged.dataUrl,
        title: outputName.trim() || 'Merged_Document',
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: merged.pageCount,
      });
      setSelectedIds([]);
      setFeedback(`Merged ${chosen.length} PDFs (${merged.pageCount} total pages).`);
    } finally {
      setBusy(false);
    }
  };

  const handleEditorCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editorStageRef.current) return;
    const rect = editorStageRef.current.getBoundingClientRect();
    const xPct = Math.max(0.02, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const yPct = Math.max(0.02, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    const newEdit: PdfTextAnnotation = {
      id: crypto.randomUUID(),
      pageIndex: editorPageIdx,
      text: draftText.trim() || 'New Text',
      xPct,
      yPct,
      fontSize: draftFontSize,
      colorHex: draftColor,
      bold: draftBold,
      whiteoutBg: draftWhiteout,
      whiteoutWidthPct: 0.25,
    };
    setTextEdits((prev) => [...prev, newEdit]);
  };

  const handleAdoptSpanForEdit = (span: ExtractedPdfTextSpan) => {
    const edit: PdfTextAnnotation = {
      id: crypto.randomUUID(),
      pageIndex: span.pageIndex,
      text: span.text,
      xPct: span.xPct,
      yPct: span.yPct,
      fontSize: span.fontSize,
      colorHex: draftColor,
      bold: draftBold,
      whiteoutBg: true,
      whiteoutWidthPct: span.widthPct + 0.03,
    };
    setTextEdits((prev) => [...prev, edit]);
  };

  const handleSaveTextEditedPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target || textEdits.length === 0) return;
    setBusy(true);
    setFeedback('');
    try {
      const res = await applyPdfTextEdits(target.dataUrl, textEdits);
      await onSaveGeneratedDocument({
        dataUrl: res.dataUrl,
        title: `${target.title}_TextEdited`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: res.pageCount,
      });
      setFeedback(`Saved PDF with ${textEdits.length} text edit(s) (${formatBytes(res.sizeBytes)}).`);
      setTextEdits([]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not save edited PDF.');
    } finally {
      setBusy(false);
    }
  };

  const handleCleanPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const cleaned = await cleanPdfDocument(target.dataUrl, {
        cleanStrength,
        mode: cleanMode,
        quality: cleanQuality,
      });
      await onSaveGeneratedDocument({
        dataUrl: cleaned.dataUrl,
        title: `${target.title}_Cleaned`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: cleaned.pageCount,
      });
      setFeedback(`Cleaned PDF saved (${cleaned.pageCount} pages, ${formatBytes(cleaned.sizeBytes)}).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'PDF clean failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleProtectPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) {
      setFeedback('Select a PDF to protect first.');
      return;
    }
    if (protectPassword.length < 3) {
      setFeedback('Enter a PDF password (min 3 characters).');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const locked = await protectPdfWithPassword(
        target.dataUrl,
        protectPassword,
        protectOwnerPassword || undefined
      );
      await onSaveGeneratedDocument({
        dataUrl: locked.dataUrl,
        title: `${target.title}_Protected`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: locked.pageCount,
      });
      downloadDataUrl(locked.dataUrl, `${target.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_Protected.pdf`);
      setProtectPassword('');
      setProtectOwnerPassword('');
      setFeedback(`Created password-protected PDF "${target.title}_Protected.pdf" (${formatBytes(locked.sizeBytes)}).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not password-protect PDF.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePdfPassword = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    const sourceUrl = uploadedLockedPdf?.dataUrl || target?.dataUrl;
    const sourceTitle = uploadedLockedPdf?.name.replace(/\.pdf$/i, '') || target?.title || 'Document';
    if (!sourceUrl) {
      setFeedback('Select a library PDF or choose a password-locked .pdf file first.');
      return;
    }
    if (!unlockPdfPassword) {
      setFeedback('Enter the current password of the locked PDF.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const unlocked = await removePdfPassword(sourceUrl, unlockPdfPassword);
      await onSaveGeneratedDocument({
        dataUrl: unlocked.dataUrl,
        title: `${sourceTitle}_Unlocked`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: unlocked.pageCount,
      });
      setUnlockPdfPassword('');
      setUploadedLockedPdf(null);
      setFeedback(`Password removed! Saved unlocked "${sourceTitle}_Unlocked.pdf" (${unlocked.pageCount} pages).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Incorrect PDF password.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOrganizedPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target || organizedPages.length === 0) return;
    setBusy(true);
    setFeedback('');
    try {
      const rebuilt = await rebuildPdfPages(target.dataUrl, organizedPages);
      await onSaveGeneratedDocument({
        dataUrl: rebuilt.dataUrl,
        title: `${target.title}_Organized`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: rebuilt.pageCount,
      });
      setFeedback(`Saved reorganized PDF (${rebuilt.pageCount} pages).`);
    } finally {
      setBusy(false);
    }
  };

  const handleSplitPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const indices: number[] = [];
      pageRangeInput
        .split(',')
        .map((s) => s.trim())
        .forEach((part) => {
          if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            if (!isNaN(a) && !isNaN(b)) {
              for (let p = Math.min(a, b); p <= Math.max(a, b); p++) indices.push(p - 1);
            }
          } else {
            const n = Number(part);
            if (!isNaN(n)) indices.push(n - 1);
          }
        });
      const extracted = await extractPdfPages(target.dataUrl, indices);
      await onSaveGeneratedDocument({
        dataUrl: extracted.dataUrl,
        title: `${target.title}_Extracted`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: extracted.pageCount,
      });
      setFeedback(`Extracted ${extracted.pageCount} page(s) into a new PDF.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Split failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRotatePdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const rotated = await rotatePdfAllOrSelected(target.dataUrl, rotateAngle);
      await onSaveGeneratedDocument({
        dataUrl: rotated.dataUrl,
        title: `${target.title}_Rotated_${rotateAngle}`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: rotated.pageCount,
      });
      setFeedback(`Rotated PDF by ${rotateAngle}° and saved copy.`);
    } finally {
      setBusy(false);
    }
  };

  const handleCompressPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const compressed = await compressPdfViaRasterize(target.dataUrl, 0.58);
      await onSaveGeneratedDocument({
        dataUrl: compressed.dataUrl,
        title: `${target.title}_Compressed`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: compressed.pageCount,
      });
      setFeedback(`Compressed PDF saved (${formatBytes(compressed.sizeBytes)}).`);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyWatermark = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const stamped = await addWatermarkToPdf(target.dataUrl, watermarkText, {
        diagonal: watermarkDiagonal,
        opacity: watermarkOpacity,
      });
      await onSaveGeneratedDocument({
        dataUrl: stamped.dataUrl,
        title: `${target.title}_Stamped`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: stamped.pageCount,
      });
      setFeedback(`Applied "${watermarkText}" watermark to ${stamped.pageCount} page(s).`);
    } finally {
      setBusy(false);
    }
  };

  const handlePdfToImages = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const imgs = await pdfToImages(target.dataUrl, 1.5, 0.88);
      for (let i = 0; i < imgs.length; i++) {
        await onSaveGeneratedDocument({
          dataUrl: imgs[i],
          title: `${target.title}_Page_${i + 1}`,
          category: 'Images',
          mimeType: 'image/jpeg',
          fileExtension: 'jpg',
          pageCount: 1,
        });
      }
      setFeedback(`Converted ${imgs.length} PDF page(s) to JPEG images in library.`);
    } finally {
      setBusy(false);
    }
  };

  const handleExportEncryptedVault = async () => {
    const target = documents.find((d) => d.id === vaultDocId);
    if (!target || vaultPassword.length < 4) {
      setFeedback('Select a document and enter a vault password (min 4 characters).');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const encrypted = await encryptDocumentVault(
        {
          title: target.title,
          fileName: target.fileName,
          mimeType: target.mimeType,
          dataUrl: target.dataUrl,
        },
        vaultPassword
      );
      const blob = new Blob([encrypted], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${target.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mfsvault`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setVaultPassword('');
      setFeedback(`Exported AES-256 encrypted vault for "${target.title}".`);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockVaultFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!unlockPassword) {
      setFeedback('Enter the vault unlock password before choosing the .mfsvault file.');
      e.target.value = '';
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const text = await file.text();
      const restored = await decryptDocumentVault(text, unlockPassword);
      const isPdf = restored.mimeType === 'application/pdf';
      await onSaveGeneratedDocument({
        dataUrl: restored.dataUrl,
        title: restored.title,
        category: isPdf ? 'PDFs' : 'Imported',
        mimeType: restored.mimeType,
        fileExtension: restored.fileName.split('.').pop() || (isPdf ? 'pdf' : 'jpg'),
        pageCount: 1,
      });
      setUnlockPassword('');
      setFeedback(`Unlocked and restored "${restored.title}" to library.`);
    } catch {
      setFeedback('Incorrect password or corrupted .mfsvault file.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleCropPdf = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    setBusy(true);
    setFeedback('');
    try {
      const res = await cropPdfPages(
        target.dataUrl,
        pdfCropRect,
        pdfCropApplyAll ? undefined : [editorPageIdx]
      );
      await onSaveGeneratedDocument({
        dataUrl: res.dataUrl,
        title: `${target.title}_Cropped`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: res.pageCount,
      });
      setFeedback(
        `Saved cropped PDF (${res.pageCount} page(s), ${formatBytes(res.sizeBytes)}) to library.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'PDF crop failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleResizePdfManualSize = async () => {
    const target = pdfDocs.find((d) => d.id === singlePdfId);
    if (!target) return;
    const rawNum = parseFloat(pdfTargetVal);
    if (Number.isNaN(rawNum) || rawNum <= 0) {
      setFeedback('Enter a valid target size in KB or MB.');
      return;
    }
    const targetBytes =
      pdfTargetUnit === 'MB' ? Math.round(rawNum * 1024 * 1024) : Math.round(rawNum * 1024);
    setBusy(true);
    setFeedback('');
    try {
      const res = await resizePdfToManualSize(target.dataUrl, targetBytes);
      await onSaveGeneratedDocument({
        dataUrl: res.dataUrl,
        title: `${target.title}_${rawNum}${pdfTargetUnit}`,
        category: 'PDFs',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        pageCount: res.pageCount,
      });
      setFeedback(
        res.achievedTarget
          ? `Resized PDF to ${formatBytes(res.sizeBytes)} (under your ${rawNum} ${pdfTargetUnit} limit) and saved copy.`
          : `Saved smallest achievable PDF at ${formatBytes(res.sizeBytes)} (${res.pageCount} pages).`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'PDF resize failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePdfCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pdfCropDragRef.current || !pdfCropStageRef.current) return;
    const rect = pdfCropStageRef.current.getBoundingClientRect();
    const dx = (e.clientX - pdfCropDragRef.current.startX) / rect.width;
    const dy = (e.clientY - pdfCropDragRef.current.startY) / rect.height;
    const orig = pdfCropDragRef.current.orig;

    if (pdfCropDragRef.current.type === 'move') {
      setPdfCropRect({
        ...orig,
        x: Math.max(0, Math.min(1 - orig.width, orig.x + dx)),
        y: Math.max(0, Math.min(1 - orig.height, orig.y + dy)),
      });
      return;
    }

    const h = pdfCropDragRef.current.handle!;
    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;
    const minSpan = 0.08;

    if (h.includes('w')) left = Math.max(0, Math.min(right - minSpan, orig.x + dx));
    if (h.includes('e')) right = Math.min(1, Math.max(left + minSpan, orig.x + orig.width + dx));
    if (h.includes('n')) top = Math.max(0, Math.min(bottom - minSpan, orig.y + dy));
    if (h.includes('s')) bottom = Math.min(1, Math.max(top + minSpan, orig.y + orig.height + dy));

    setPdfCropRect({
      x: left,
      y: top,
      width: Math.max(minSpan, right - left),
      height: Math.max(minSpan, bottom - top),
    });
  };

  const tabs: Array<{ id: PdfToolTab; label: string; icon: typeof FileText }> = [
    { id: 'img-to-pdf', label: 'Images to PDF', icon: FileDown },
    { id: 'text-editor', label: 'PDF Text Editor', icon: Type },
    { id: 'crop-resize', label: 'Crop & Target KB', icon: Crop },
    { id: 'clean-pdf', label: 'Clean PDF', icon: Wand2 },
    { id: 'password', label: 'PDF Password', icon: Lock },
    { id: 'organize', label: 'Organize Pages', icon: LayoutGrid },
    { id: 'merge', label: 'Merge PDFs', icon: Layers },
    { id: 'split', label: 'Split / Extract', icon: Scissors },
    { id: 'rotate-compress', label: 'Rotate & Compress', icon: Minimize2 },
    { id: 'watermark', label: 'Watermark', icon: Stamp },
    { id: 'pdf-to-img', label: 'PDF to Images', icon: ImageIcon },
  ];

  const pageSpans = extractedSpans.filter((s) => s.pageIndex === editorPageIdx);
  const pageEdits = textEdits.filter((e) => e.pageIndex === editorPageIdx);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">PDF Management, Text Editor & Security Toolbox</h2>
          <p className="text-sm text-slate-500">
            Edit PDF text & whiteout, clean scanned PDF pages, add or remove PDF passwords, merge, organize, and convert.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white border border-slate-200 hover:border-emerald-700 text-slate-800 rounded-xl"
          >
            <Upload className="w-4 h-4 text-emerald-700" />
            Import Local PDF / Images
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            onChange={handleUploadLocalFiles}
            className="hidden"
          />
        </div>
      </div>

      {/* Tool Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl w-fit">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                setSelectedIds([]);
                setFeedback('');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                active ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
          {feedback}
        </div>
      )}

      {/* Images to PDF */}
      {activeTab === 'img-to-pdf' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Select Images ({selectedIds.length} selected)
              </h3>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  Clear selection
                </button>
              )}
            </div>
            {imageDocs.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                No image scans in library yet. Capture or import images first.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {imageDocs.map((doc) => {
                  const selected = selectedIds.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleId(doc.id)}
                      className={`text-left p-2 rounded-xl border transition-colors ${
                        selected
                          ? 'border-emerald-700 bg-emerald-50/70'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <img
                        src={doc.dataUrl}
                        alt={doc.title}
                        className="w-full h-28 object-cover rounded-lg mb-2"
                      />
                      <div className="text-xs font-medium text-slate-900 truncate">{doc.title}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatBytes(doc.sizeBytes)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 h-fit">
            <h3 className="text-sm font-semibold text-slate-900">PDF Output Configuration</h3>
            <label className="block text-xs text-slate-700">
              File Name
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-700">
                Paper Size
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                  className="mt-1 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                  <option value="Custom">Custom</option>
                </select>
              </label>
              <label className="block text-xs text-slate-700">
                Orientation
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
                  className="mt-1 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            </div>
            <label className="block text-xs text-slate-700">
              <div className="flex justify-between mb-1">
                <span>Margins (pt)</span>
                <span className="font-mono tabular-nums">{marginPt} pt</span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={marginPt}
                onChange={(e) => setMarginPt(Number(e.target.value))}
                className="w-full accent-emerald-700"
              />
            </label>
            <label className="block text-xs text-slate-700">
              <div className="flex justify-between mb-1">
                <span>Compression Quality</span>
                <span className="font-mono tabular-nums">{Math.round(quality * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={100}
                value={Math.round(quality * 100)}
                onChange={(e) => setQuality(Number(e.target.value) / 100)}
                className="w-full accent-emerald-700"
              />
            </label>
            <button
              type="button"
              onClick={handleImagesToPdf}
              disabled={busy || selectedIds.length === 0}
              className="w-full py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Generate PDF ({selectedIds.length} images)
            </button>
          </div>
        </div>
      )}

      {/* PDF TEXT EDITOR */}
      {activeTab === 'text-editor' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={singlePdfId}
                onChange={(e) => setSinglePdfId(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 min-w-[240px]"
              >
                <option value="">-- Choose a PDF to Edit Text --</option>
                {pdfDocs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.pageCount} pages)
                  </option>
                ))}
              </select>
              {editorPageImgs.length > 0 && (
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1 text-xs">
                  <button
                    type="button"
                    disabled={editorPageIdx === 0}
                    onClick={() => setEditorPageIdx((i) => Math.max(0, i - 1))}
                    className="p-1 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono tabular-nums">
                    Page {editorPageIdx + 1}/{editorPageImgs.length}
                  </span>
                  <button
                    type="button"
                    disabled={editorPageIdx >= editorPageImgs.length - 1}
                    onClick={() => setEditorPageIdx((i) => Math.min(editorPageImgs.length - 1, i + 1))}
                    className="p-1 disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="mx-1 text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => setEditorZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                    className="p-1"
                    aria-label="Zoom out PDF editor"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono tabular-nums">{Math.round(editorZoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setEditorZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))))}
                    className="p-1"
                    aria-label="Zoom in PDF editor"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={busy || !singlePdfId || textEdits.length === 0}
              onClick={handleSaveTextEditedPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Edited PDF ({textEdits.length} edits)
            </button>
          </div>

          {loadingEditor && (
            <div className="py-12 text-center text-xs text-slate-500">
              Rendering PDF canvas & reading text blocks...
            </div>
          )}

          {singlePdfId && !loadingEditor && editorPageImgs[editorPageIdx] && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Interactive Click-to-Place PDF Canvas */}
              <div className="lg:col-span-2 bg-slate-900 rounded-2xl p-4 overflow-auto flex items-start justify-center min-h-[460px]">
                <div
                  ref={editorStageRef}
                  onClick={handleEditorCanvasClick}
                  style={{ transform: `scale(${editorZoom})`, transformOrigin: 'top center' }}
                  className="relative inline-block cursor-crosshair select-none shadow-2xl"
                >
                  <img
                    src={editorPageImgs[editorPageIdx]}
                    alt={`PDF Page ${editorPageIdx + 1}`}
                    className="max-w-full max-h-[68vh] w-auto block rounded"
                    draggable={false}
                  />
                  {pageEdits.map((ed) => (
                    <div
                      key={ed.id}
                      onClick={(ev) => ev.stopPropagation()}
                      style={{
                        left: `${ed.xPct * 100}%`,
                        top: `${ed.yPct * 100}%`,
                        fontSize: `${ed.fontSize}px`,
                        color: ed.colorHex,
                        fontWeight: ed.bold ? 700 : 400,
                        backgroundColor: ed.whiteoutBg ? 'rgba(255,255,255,0.95)' : 'transparent',
                      }}
                      className="absolute px-1 py-0.5 rounded border border-emerald-500 shadow-sm whitespace-nowrap leading-none"
                    >
                      {ed.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Text Controls & Detected Existing Spans */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Click anywhere on PDF page to insert text
                  </div>
                  <label className="block text-xs text-slate-700">
                    Next Placement Text
                    <input
                      type="text"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label>
                      Size (pt)
                      <input
                        type="number"
                        min={8}
                        max={48}
                        value={draftFontSize}
                        onChange={(e) => setDraftFontSize(Number(e.target.value) || 12)}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg bg-white"
                      />
                    </label>
                    <label>
                      Color
                      <select
                        value={draftColor}
                        onChange={(e) => setDraftColor(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="#0f172a">Black</option>
                        <option value="#065f46">Emerald</option>
                        <option value="#1d4ed8">Blue</option>
                        <option value="#b91c1c">Red</option>
                      </select>
                    </label>
                    <div className="flex flex-col justify-end gap-1 pb-1">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={draftBold}
                          onChange={(e) => setDraftBold(e.target.checked)}
                          className="accent-emerald-700"
                        />
                        Bold
                      </label>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={draftWhiteout}
                      onChange={(e) => setDraftWhiteout(e.target.checked)}
                      className="accent-emerald-700"
                    />
                    Whiteout background (replace existing PDF text cleanly)
                  </label>
                </div>

                {/* Active Text Edits */}
                {textEdits.length > 0 && (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2 max-h-48 overflow-y-auto">
                    <div className="text-xs font-semibold text-emerald-950">
                      Active Edits ({textEdits.length})
                    </div>
                    {textEdits.map((ed) => (
                      <div key={ed.id} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={ed.text}
                          onChange={(e) =>
                            setTextEdits((prev) =>
                              prev.map((item) =>
                                item.id === ed.id ? { ...item, text: e.target.value } : item
                              )
                            )
                          }
                          className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setTextEdits((prev) => prev.filter((item) => item.id !== ed.id))
                          }
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                          aria-label="Remove text edit"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Detected Existing PDF Text Spans */}
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2 max-h-56 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-800">
                    Existing PDF Text Lines on Page {editorPageIdx + 1} ({pageSpans.length})
                  </div>
                  {pageSpans.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Scanned image-only PDF page — click directly on the canvas to place or whiteout-overwrite text.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {pageSpans.slice(0, 35).map((sp) => (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => handleAdoptSpanForEdit(sp)}
                          className="w-full text-left px-2.5 py-1.5 text-xs bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-600 rounded-lg flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{sp.text}</span>
                          <Plus className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PDF CROP & MANUAL FILE SIZE RESIZE TAB */}
      {activeTab === 'crop-resize' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={singlePdfId}
              onChange={(e) => setSinglePdfId(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 min-w-[260px]"
            >
              <option value="">-- Choose a PDF to Crop or Resize --</option>
              {pdfDocs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.pageCount} pages · {formatBytes(p.sizeBytes)})
                </option>
              ))}
            </select>

            {editorPageImgs.length > 1 && (
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-2.5 py-1 text-xs">
                <button
                  type="button"
                  disabled={editorPageIdx === 0}
                  onClick={() => setEditorPageIdx((i) => Math.max(0, i - 1))}
                  className="p-1 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono tabular-nums">
                  Page {editorPageIdx + 1}/{editorPageImgs.length}
                </span>
                <button
                  type="button"
                  disabled={editorPageIdx >= editorPageImgs.length - 1}
                  onClick={() => setEditorPageIdx((i) => Math.min(editorPageImgs.length - 1, i + 1))}
                  className="p-1 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {loadingEditor && (
            <div className="py-12 text-center text-xs text-slate-500">Rendering PDF page preview...</div>
          )}

          {singlePdfId && !loadingEditor && editorPageImgs[editorPageIdx] && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Interactive PDF Crop Box */}
              <div className="lg:col-span-2 bg-slate-900 rounded-2xl p-4 flex items-center justify-center min-h-[420px]">
                <div
                  ref={pdfCropStageRef}
                  onPointerMove={handlePdfCropPointerMove}
                  onPointerUp={() => {
                    pdfCropDragRef.current = null;
                  }}
                  onPointerLeave={() => {
                    pdfCropDragRef.current = null;
                  }}
                  className="relative inline-block select-none touch-none overflow-hidden rounded"
                >
                  <img
                    src={editorPageImgs[editorPageIdx]}
                    alt={`Crop PDF Page ${editorPageIdx + 1}`}
                    className="max-h-[64vh] w-auto block"
                    draggable={false}
                  />
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      pdfCropDragRef.current = {
                        type: 'move',
                        startX: e.clientX,
                        startY: e.clientY,
                        orig: pdfCropRect,
                      };
                    }}
                    style={{
                      left: `${pdfCropRect.x * 100}%`,
                      top: `${pdfCropRect.y * 100}%`,
                      width: `${pdfCropRect.width * 100}%`,
                      height: `${pdfCropRect.height * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.58)',
                    }}
                    className="absolute border-2 border-emerald-400 cursor-move"
                  >
                    {(
                      [
                        { id: 'nw', style: { left: '0%', top: '0%' }, cursor: 'nwse-resize' },
                        { id: 'ne', style: { left: '100%', top: '0%' }, cursor: 'nesw-resize' },
                        { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
                        { id: 'sw', style: { left: '0%', top: '100%' }, cursor: 'nesw-resize' },
                        { id: 'n', style: { left: '50%', top: '0%' }, cursor: 'ns-resize' },
                        { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
                        { id: 'w', style: { left: '0%', top: '50%' }, cursor: 'ew-resize' },
                        { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
                      ] as const
                    ).map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        aria-label={`Resize PDF crop ${h.id}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          pdfCropDragRef.current = {
                            type: 'handle',
                            handle: h.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            orig: pdfCropRect,
                          };
                        }}
                        style={{ ...h.style, cursor: h.cursor }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-emerald-600 rounded-sm shadow"
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Panel: Crop Presets & Manual Target KB/MB Resize */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">PDF Crop Presets</div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {[
                      { label: 'Trim Margins (8%)', rect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 } },
                      { label: 'Top Half Page', rect: { x: 0, y: 0, width: 1, height: 0.5 } },
                      { label: 'Bottom Half Page', rect: { x: 0, y: 0.5, width: 1, height: 0.5 } },
                      { label: 'Full Page Reset', rect: { x: 0, y: 0, width: 1, height: 1 } },
                    ].map((pr) => (
                      <button
                        key={pr.label}
                        type="button"
                        onClick={() => setPdfCropRect(pr.rect)}
                        className="py-1.5 px-2 bg-white border border-slate-200 hover:border-emerald-700 rounded-lg font-medium text-slate-700"
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={pdfCropApplyAll}
                      onChange={(e) => setPdfCropApplyAll(e.target.checked)}
                      className="accent-emerald-700"
                    />
                    Apply crop to all pages
                  </label>
                  <button
                    type="button"
                    onClick={handleCropPdf}
                    disabled={busy}
                    className="w-full py-2.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl disabled:opacity-50"
                  >
                    {busy ? 'Cropping PDF...' : 'Apply PDF Crop & Save'}
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Manual PDF File Size Feed (KB / MB)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={20}
                      step="any"
                      value={pdfTargetVal}
                      onChange={(e) => setPdfTargetVal(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white"
                      aria-label="Target PDF size"
                    />
                    <select
                      value={pdfTargetUnit}
                      onChange={(e) => setPdfTargetUnit(e.target.value as 'KB' | 'MB')}
                      className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '100 KB', v: '100', u: 'KB' as const },
                      { label: '250 KB', v: '250', u: 'KB' as const },
                      { label: '500 KB', v: '500', u: 'KB' as const },
                      { label: '1 MB', v: '1', u: 'MB' as const },
                    ].map((pr) => (
                      <button
                        key={pr.label}
                        type="button"
                        onClick={() => {
                          setPdfTargetVal(pr.v);
                          setPdfTargetUnit(pr.u);
                        }}
                        className="px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded-md hover:border-emerald-700"
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleResizePdfManualSize}
                    disabled={busy}
                    className="w-full py-2.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-xl disabled:opacity-50"
                  >
                    {busy ? 'Resizing PDF...' : `Resize PDF Under ${pdfTargetVal || '0'} ${pdfTargetUnit}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CLEAN PDF TOOL */}
      {activeTab === 'clean-pdf' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5 max-w-2xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Sparkles className="w-4 h-4 text-emerald-700" />
            PDF Clean Tool (Shadow Removal, Paper Whitening & Dust Cleanup)
          </div>
          <label className="block text-xs font-semibold text-slate-700">
            Select PDF to Clean
            <select
              value={singlePdfId}
              onChange={(e) => setSinglePdfId(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
            >
              <option value="">-- Choose a PDF from library --</option>
              {pdfDocs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.pageCount} pages · {formatBytes(p.sizeBytes)})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-xs text-slate-700">
              Clean Mode
              <select
                value={cleanMode}
                onChange={(e) => setCleanMode(e.target.value as DocumentFilterMode)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
              >
                <option value="color">Color Document Clean (Keep Stamps)</option>
                <option value="grayscale">Grayscale Clean Document</option>
                <option value="bw">Crisp Black & White High-Contrast</option>
              </select>
            </label>
            <label className="block text-xs text-slate-700">
              <div className="flex justify-between mb-1">
                <span>Whitening & Dust Strength</span>
                <span className="font-mono tabular-nums">{cleanStrength}%</span>
              </div>
              <input
                type="range"
                min={35}
                max={100}
                value={cleanStrength}
                onChange={(e) => setCleanStrength(Number(e.target.value))}
                className="w-full accent-emerald-700 mt-2"
              />
            </label>
          </div>
          <label className="block text-xs text-slate-700">
            <div className="flex justify-between mb-1">
              <span>Output PDF Quality</span>
              <span className="font-mono tabular-nums">{Math.round(cleanQuality * 100)}%</span>
            </div>
            <input
              type="range"
              min={60}
              max={95}
              value={Math.round(cleanQuality * 100)}
              onChange={(e) => setCleanQuality(Number(e.target.value) / 100)}
              className="w-full accent-emerald-700"
            />
          </label>
          <button
            type="button"
            disabled={busy || !singlePdfId}
            onClick={handleCleanPdf}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Clean All Pages & Save New PDF
          </button>
        </div>
      )}

      {/* PDF PASSWORD MAKE & REMOVE + AES-256 VAULT */}
      {activeTab === 'password' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Make Password-Protected PDF */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-emerald-700" />
                Make Password-Protected PDF (Lock .pdf)
              </div>
              <p className="text-xs text-slate-500">
                Creates a standard encrypted PDF that requires a password to open in Chrome, Edge, Adobe Acrobat, and mobile PDF viewers.
              </p>
              <label className="block text-xs text-slate-700">
                Select PDF
                <select
                  value={singlePdfId}
                  onChange={(e) => setSinglePdfId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                >
                  <option value="">-- Choose PDF --</option>
                  {pdfDocs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.pageCount} pages)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-700">
                PDF Open Password (User Password)
                <input
                  type="password"
                  value={protectPassword}
                  onChange={(e) => setProtectPassword(e.target.value)}
                  placeholder="Enter password (min 3 chars)"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </label>
              <label className="block text-xs text-slate-700">
                Optional Owner Permissions Password
                <input
                  type="password"
                  value={protectOwnerPassword}
                  onChange={(e) => setProtectOwnerPassword(e.target.value)}
                  placeholder="Leave blank to use same password"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </label>
              <button
                type="button"
                onClick={handleProtectPdf}
                disabled={busy || !singlePdfId || protectPassword.length < 3}
                className="w-full py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
              >
                {busy ? 'Encrypting PDF...' : 'Create Password-Protected PDF'}
              </button>
            </div>

            {/* Remove Password from PDF */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Unlock className="w-4 h-4 text-emerald-700" />
                Remove PDF Password (Unlock .pdf)
              </div>
              <p className="text-xs text-slate-500">
                Unlock a password-protected PDF from your library or upload an encrypted <code className="font-mono">.pdf</code> file directly to save a password-free copy.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => lockedPdfInputRef.current?.click()}
                  className="w-full py-2 px-3 text-xs font-medium border border-dashed border-emerald-700 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-900 rounded-xl"
                >
                  {uploadedLockedPdf
                    ? `Selected Locked File: ${uploadedLockedPdf.name}`
                    : 'Choose Locked .pdf File from Device (or use selected library PDF)'}
                </button>
                <input
                  ref={lockedPdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      setUploadedLockedPdf({ name: f.name, dataUrl: String(reader.result || '') });
                    };
                    reader.readAsDataURL(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </div>
              <label className="block text-xs text-slate-700">
                Current PDF Password
                <input
                  type="password"
                  value={unlockPdfPassword}
                  onChange={(e) => setUnlockPdfPassword(e.target.value)}
                  placeholder="Enter password of the protected PDF"
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </label>
              <button
                type="button"
                onClick={handleRemovePdfPassword}
                disabled={busy || (!uploadedLockedPdf && !singlePdfId) || !unlockPdfPassword}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
              >
                {busy ? 'Unlocking PDF...' : 'Remove Password & Save Unlocked PDF'}
              </button>
            </div>
          </div>

          {/* Encrypted Multi-File AES-256 Vault (.mfsvault) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 border-t border-slate-200">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="text-xs font-semibold text-slate-800">
                AES-256 Document Vault Export (.mfsvault — Images & PDFs)
              </div>
              <select
                value={vaultDocId}
                onChange={(e) => setVaultDocId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50"
              >
                <option value="">-- Select document --</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({d.fileExtension.toUpperCase()})
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  placeholder="Vault password (min 4 chars)"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <button
                  type="button"
                  onClick={handleExportEncryptedVault}
                  disabled={busy || !vaultDocId}
                  className="px-4 py-2 bg-emerald-800 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  Lock .mfsvault
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="text-xs font-semibold text-slate-800">
                Restore AES-256 Encrypted .mfsvault
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Enter vault password"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <button
                  type="button"
                  onClick={() => vaultFileInputRef.current?.click()}
                  disabled={busy || !unlockPassword}
                  className="px-4 py-2 border border-slate-200 hover:border-emerald-700 text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  Unlock File
                </button>
                <input
                  ref={vaultFileInputRef}
                  type="file"
                  accept=".mfsvault,application/json"
                  onChange={handleUnlockVaultFile}
                  className="hidden"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merge PDFs */}
      {activeTab === 'merge' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Select 2 or more PDFs to Merge ({selectedIds.length} selected)
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="Merged PDF name"
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={handleMergePdfs}
                disabled={busy || selectedIds.length < 2}
                className="px-4 py-2 text-xs font-semibold bg-emerald-800 text-white rounded-lg disabled:opacity-50"
              >
                {busy ? 'Merging...' : 'Merge Selected PDFs'}
              </button>
            </div>
          </div>

          {pdfDocs.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              No PDFs available yet. Create one via Images to PDF or import a PDF.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pdfDocs.map((doc) => {
                const selected = selectedIds.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => toggleId(doc.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left ${
                      selected ? 'border-emerald-700 bg-emerald-50/70' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <FileText className="w-8 h-8 text-emerald-700 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{doc.title}</div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {doc.pageCount} pages · {formatBytes(doc.sizeBytes)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Single-PDF Tools: Organize / Split / Rotate-Compress / Watermark / PDF-to-Images */}
      {(activeTab === 'organize' ||
        activeTab === 'split' ||
        activeTab === 'rotate-compress' ||
        activeTab === 'watermark' ||
        activeTab === 'pdf-to-img') && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">Select Target PDF</label>
            <select
              value={singlePdfId}
              onChange={(e) => setSinglePdfId(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
            >
              <option value="">-- Choose a PDF from library --</option>
              {pdfDocs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.pageCount} pages · {formatBytes(p.sizeBytes)})
                </option>
              ))}
            </select>
          </div>

          {singlePdfId && activeTab === 'organize' && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 tabular-nums">
                  {loadingThumbs ? 'Rendering page thumbnails...' : `${organizedPages.length} pages ready`}
                </span>
                <button
                  type="button"
                  onClick={handleSaveOrganizedPdf}
                  disabled={busy || organizedPages.length === 0}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl disabled:opacity-50"
                >
                  {busy ? 'Rebuilding PDF...' : 'Save Reorganized PDF'}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {organizedPages.map((pg, idx) => (
                  <div
                    key={`${pg.zeroBasedIndex}-${idx}`}
                    className="border border-slate-200 rounded-xl p-2 bg-slate-50 space-y-2"
                  >
                    <div className="h-36 bg-white rounded-lg overflow-hidden flex items-center justify-center border border-slate-100">
                      <img
                        src={pg.thumb}
                        alt={`Page ${idx + 1}`}
                        style={{ transform: `rotate(${pg.rotationDelta}deg)` }}
                        className="max-h-full max-w-full object-contain transition-transform"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono tabular-nums text-slate-600">P{idx + 1}</span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() =>
                            setOrganizedPages((prev) => {
                              const copy = [...prev];
                              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                              return copy;
                            })
                          }
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                          title="Move Left"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === organizedPages.length - 1}
                          onClick={() =>
                            setOrganizedPages((prev) => {
                              const copy = [...prev];
                              [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                              return copy;
                            })
                          }
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                          title="Move Right"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOrganizedPages((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      rotationDelta: ((item.rotationDelta + 90) % 360) as 0 | 90 | 180 | 270,
                                    }
                                  : item
                              )
                            )
                          }
                          className="p-1 hover:bg-slate-200 rounded"
                          title="Rotate 90°"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={organizedPages.length <= 1}
                          onClick={() =>
                            setOrganizedPages((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30"
                          title="Remove Page"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {singlePdfId && activeTab === 'split' && (
            <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100">
              <label className="text-xs text-slate-700">
                Page numbers or range (e.g. 1, 2-4)
                <input
                  type="text"
                  value={pageRangeInput}
                  onChange={(e) => setPageRangeInput(e.target.value)}
                  className="mt-1 block w-56 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                />
              </label>
              <button
                type="button"
                onClick={handleSplitPdf}
                disabled={busy}
                className="px-4 py-2.5 text-xs font-semibold bg-emerald-800 text-white rounded-xl hover:bg-emerald-900"
              >
                {busy ? 'Extracting...' : 'Extract Pages to New PDF'}
              </button>
            </div>
          )}

          {singlePdfId && activeTab === 'rotate-compress' && (
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
              <select
                value={rotateAngle}
                onChange={(e) => setRotateAngle(Number(e.target.value) as 90 | 180 | 270)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
              >
                <option value={90}>Rotate 90° Clockwise</option>
                <option value={180}>Rotate 180°</option>
                <option value={270}>Rotate 270°</option>
              </select>
              <button
                type="button"
                onClick={handleRotatePdf}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 text-white rounded-lg"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Rotate & Save Copy
              </button>
              <button
                type="button"
                onClick={handleCompressPdf}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                Compress PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pdfDocs.find((d) => d.id === singlePdfId);
                  if (target) downloadDataUrl(target.dataUrl, target.fileName);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download Original
              </button>
            </div>
          )}

          {singlePdfId && activeTab === 'watermark' && (
            <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-slate-100">
              <label className="text-xs text-slate-700">
                Watermark / Stamp Text
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  className="mt-1 block w-56 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </label>
              <label className="text-xs text-slate-700">
                Opacity ({Math.round(watermarkOpacity * 100)}%)
                <input
                  type="range"
                  min={10}
                  max={65}
                  value={Math.round(watermarkOpacity * 100)}
                  onChange={(e) => setWatermarkOpacity(Number(e.target.value) / 100)}
                  className="mt-2 block w-36 accent-emerald-700"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={watermarkDiagonal}
                  onChange={(e) => setWatermarkDiagonal(e.target.checked)}
                  className="accent-emerald-700 w-4 h-4"
                />
                Diagonal Stamp
              </label>
              <button
                type="button"
                onClick={handleApplyWatermark}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl"
              >
                <Stamp className="w-3.5 h-3.5" />
                {busy ? 'Stamping...' : 'Apply Watermark & Save'}
              </button>
            </div>
          )}

          {singlePdfId && activeTab === 'pdf-to-img' && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handlePdfToImages}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-emerald-800 text-white rounded-xl hover:bg-emerald-900"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                Convert All Pages to JPEG Images
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
