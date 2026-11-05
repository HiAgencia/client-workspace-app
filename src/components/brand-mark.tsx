import geometry from "./brand-geometry.json";

export function BrandMark({ className }: { className?: string }) {
  const { bars } = geometry;
  return (
    <svg className={className} viewBox="5 7 22 18" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {bars.map((bar) => (
          <rect key={`${bar.x}-${bar.y}`} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={bar.h / 2} />
        ))}
      </g>
    </svg>
  );
}
