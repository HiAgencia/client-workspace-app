// The product's mark, drawn for it from its own motif: three bars stepping in, the client → project → subproject tree.
// The same geometry draws the site's icons (`scripts/icons.mjs`).
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent-fill)" />
      <g fill="var(--on-accent)">
        <rect x="6" y="8" width="12" height="4" rx="2" />
        <rect x="10" y="14" width="12" height="4" rx="2" />
        <rect x="14" y="20" width="12" height="4" rx="2" />
      </g>
    </svg>
  );
}
