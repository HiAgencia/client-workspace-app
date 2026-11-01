import geometry from "./brand-geometry.json";



export function BrandMark({ className }: { className?: string }) {
  const { size, tileRadius, bars } = geometry;
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <rect width={size} height={size} rx={tileRadius} fill="var(--brand-tile)" />
      <g fill="var(--brand-ink)">
        {bars.map((bar) => (
          <rect key={`${bar.x}-${bar.y}`} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={bar.h / 2} />
        ))}
      </g>
    </svg>
  );
}
