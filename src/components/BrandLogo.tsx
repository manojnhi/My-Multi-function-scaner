import { useState } from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export function BrandLogo({ size = 32, className = '' }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-lg bg-slate-100 border border-slate-200 text-slate-800 shrink-0 ${className}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-3/4 h-3/4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12L17 4.5" />
          <rect x="3" y="12" width="18" height="7" rx="1.5" fill="#ffffff" />
          <path d="M6.5 12h11l-1.5-2.5H8L6.5 12z" fill="#38bdf8" stroke="none" />
          <line x1="6" y1="15.5" x2="10" y2="15.5" stroke="#0284c7" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src="/logo.png?v=3"
      alt="Oklivo Scanner logo"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`object-contain shrink-0 rounded-md ${className}`}
    />
  );
}
