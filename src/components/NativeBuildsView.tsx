import { Check, Copy, Download, FileCode2, FolderGit2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface NativeFile {
  path: string;
  content: string;
  language: string;
}

export function NativeBuildsView() {
  const [files, setFiles] = useState<NativeFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/native-files')
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.files) ? (d.files as NativeFile[]) : [];
        setFiles(list);
        if (list.length > 0) setActivePath(list[0].path);
      })
      .catch(() => setFiles([]));
  }, []);

  const activeFile = files.find((f) => f.path === activePath) || files[0];

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.path.split('/').pop() || 'file.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Native APK, Windows EXE & Architecture Kit</h2>
        <p className="text-sm text-slate-500">
          Inspect and download the Flutter multi-platform source, Android Gradle release config, Inno Setup Windows installer script, SQLite schema, and build documentation.
        </p>
      </div>

      {/* Implementation Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Web + Real-Time Sync Stack</div>
          <div className="text-sm font-bold text-emerald-800 mt-1">Live & Running</div>
          <p className="text-xs text-slate-600 mt-1">
            Quick Capture, Auto Capture, Perspective Warp, Hindi/English OCR, PDF Toolbox, IndexedDB, and WebSocket Mobile-to-PC transfer run directly in this app.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Android APK Configuration</div>
          <div className="text-sm font-bold text-slate-900 mt-1">Source & Gradle Ready</div>
          <p className="text-xs text-slate-600 mt-1">
            Compile locally with Android SDK + Flutter using <code className="font-mono">flutter build apk --release</code>.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Windows EXE & Installer</div>
          <div className="text-sm font-bold text-slate-900 mt-1">Inno Setup & Runner Ready</div>
          <p className="text-xs text-slate-600 mt-1">
            Compile on Windows with Visual Studio 2022 + Inno Setup 6 using <code className="font-mono">my_scanner_setup.iss</code>.
          </p>
        </div>
      </div>

      {/* File Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-4 bg-white border border-slate-200 rounded-2xl overflow-hidden min-h-[460px]">
        <div className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 p-3 space-y-1">
          <div className="px-2 py-1.5 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <FolderGit2 className="w-4 h-4 text-emerald-700" />
            /native-ecosystem
          </div>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActivePath(f.path)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono flex items-center gap-2 transition-colors ${
                activeFile?.path === f.path
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-700 hover:bg-slate-200/60'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 flex flex-col min-w-0">
          {activeFile ? (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white">
                <span className="text-xs font-mono font-semibold text-slate-800 truncate">
                  {activeFile.path}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-lg hover:bg-emerald-900"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
              </div>
              <pre className="flex-1 p-4 text-xs font-mono text-slate-800 bg-slate-50/50 overflow-auto leading-relaxed">
                {activeFile.content}
              </pre>
            </>
          ) : (
            <div className="p-8 text-sm text-slate-500">Loading native build files...</div>
          )}
        </div>
      </div>
    </div>
  );
}
