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
        className={`flex items-center justify-center rounded-lg bg-emerald-900 text-white font-display font-bold shrink-0 ${className}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
          <path d="M8 7h6l3 3v7a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
          <line x1="5" y1="12" x2="19" y2="12" stroke="#34d399" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src="/assets/aistudio/file_00000000893482119598e34c909866a1_54a92453.png"
      alt="My Multi Functional Scanner logo"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`rounded-xl object-contain shrink-0 ${className}`}
    />
  );
}
