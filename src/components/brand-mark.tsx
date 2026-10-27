import geometry from "./brand-geometry.json";

// The product's mark, drawn for it from its own motif: three bars stepping in, the client → project → subproject tree.
// Its geometry lives in `brand-geometry.json`, which also draws the site's icons (`scripts/icons.mjs`).
export function BrandMark({ className }: { className?: string }) {
  const { size, tileRadius, bars } = geometry;
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <rect width={size} height={size} rx={tileRadius} fill="var(--accent-fill)" />
      <g fill="var(--on-accent)">
        {bars.map((bar) => (
          <rect key={`${bar.x}-${bar.y}`} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={bar.h / 2} />
        ))}
      </g>
    </svg>
  );
}
