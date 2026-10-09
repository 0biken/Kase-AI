import { useId } from 'react';

/**
 * The Kase mark: a K whose lower leg is the handle of a magnifier.
 * Investigation built into the letterform. The lens is a true cut-out
 * (SVG mask), so the mark reads correctly on any background.
 *
 * Geometry lives on a 40-unit grid. Change it here and only here; the
 * favicon (app/icon.svg) mirrors these paths.
 */
export function KaseMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="kase-mark"
    >
      <defs>
        <mask id={`${id}-lens`} maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
          <rect width="40" height="40" fill="#fff" />
          <circle cx="17.5" cy="21" r="9" fill="#000" />
        </mask>
        <clipPath id={`${id}-box`}>
          <rect x="4" y="4" width="32" height="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-box)`}>
        <g mask={`url(#${id}-lens)`}>
          <rect x="4" y="4" width="9.5" height="32" rx="2" />
          <path d="M11 22 31 -1" stroke="currentColor" strokeWidth="7.5" />
        </g>
        <circle cx="17.5" cy="21" r="5.4" fill="none" stroke="currentColor" strokeWidth="3.2" />
        <path d="M21.6 24.7 41 41.5" stroke="currentColor" strokeWidth="6.5" />
      </g>
    </svg>
  );
}

/** Mark + wordmark. The wordmark is set in title case: "Kase". */
export function KaseLogo({ size = 26, className = 'wordmark' }: { size?: number; className?: string }) {
  return (
    <span className={className}>
      <KaseMark size={size} />
      <span className="wordmark-text">Kase</span>
    </span>
  );
}
