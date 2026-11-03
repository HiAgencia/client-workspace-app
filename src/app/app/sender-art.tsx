import type { CSSProperties, ReactElement } from "react";






export type OrgSign = "platform" | "pos" | "mill" | "hub";
export type DemoSender = OrgSign | "person";



const DEMO_SENDERS = new Map<string, DemoSender>([
  ["noreply@developers.example", "platform"],
  ["no-reply@counterpos.example", "pos"],
  ["sales@millbrookflour.example", "mill"],
  ["billing@coworkinghub.example", "hub"],
  ["maya@larkspur.example", "person"],
  ["ana@studioatlas.example", "person"],
]);

export function demoSender(email: string | null | undefined): DemoSender | null {
  const address = email?.trim().toLowerCase() ?? "";
  return address.endsWith(".example") ? (DEMO_SENDERS.get(address) ?? null) : null;
}



export function nameSeed(name: string): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return Math.abs(hash);
}





const SIGNS: Record<OrgSign, ReactElement> = {
  platform: (
    <>
      <rect width="32" height="32" rx="8" fill="var(--demo-platform-tile)" />
      <path d="M12.2 10.6 6.9 16l5.3 5.4M19.8 10.6l5.3 5.4-5.3 5.4" fill="none" stroke="var(--demo-platform-sign)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m17.6 9.4-3.2 13.2" stroke="var(--demo-platform-accent)" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  pos: (
    <>
      <rect width="32" height="32" rx="8" fill="var(--demo-pos-tile)" />
      <path d="M10.5 7.5h11v17.6l-1.83-1.3-1.84 1.3L16 23.8l-1.83 1.3-1.84-1.3-1.83 1.3z" fill="var(--demo-pos-sign)" />
      <path d="M13.3 12.3h5.4M13.3 15.6h5.4M13.3 18.9h3.2" stroke="var(--demo-pos-tile)" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  mill: (
    <>
      <rect width="32" height="32" rx="8" fill="var(--demo-mill-tile)" />
      <g fill="var(--demo-mill-sign)">
        <path d="M15.25 12.5h1.5v14h-1.5z" />
        <ellipse cx="16" cy="7.6" rx="1.7" ry="3" />
        {[12.3, 16.8, 21.3].map((y) => (
          <g key={y}>
            <ellipse cx="13.3" cy={y} rx="1.6" ry="3" transform={`rotate(-38 13.3 ${y})`} />
            <ellipse cx="18.7" cy={y} rx="1.6" ry="3" transform={`rotate(38 18.7 ${y})`} />
          </g>
        ))}
      </g>
    </>
  ),
  hub: (
    <>
      <rect width="32" height="32" rx="8" fill="var(--demo-hub-tile)" />
      <path d="M10 10l12 12M22 10 10 22" stroke="var(--demo-hub-sign)" strokeWidth="1.6" />
      <g fill="var(--demo-hub-sign)">
        <circle cx="16" cy="16" r="3.6" />
        <circle cx="9.5" cy="9.5" r="2.4" />
        <circle cx="22.5" cy="9.5" r="2.4" />
        <circle cx="9.5" cy="22.5" r="2.4" />
        <circle cx="22.5" cy="22.5" r="2.4" />
      </g>
    </>
  ),
};

export function OrgMark({ sign }: { sign: OrgSign }) {
  return (
    <svg viewBox="0 0 32 32" className="sender-art" data-sign={sign} aria-hidden="true" focusable="false">
      {SIGNS[sign]}
      <rect className="sender-art-rim" x="0.5" y="0.5" width="31" height="31" rx="7.5" />
    </svg>
  );
}





const HAIR: Array<{ back?: string; front?: string }> = [
  { front: "M10.3 13.4c-.6-5.2 2.3-8.2 5.9-8.2 3.9 0 6.5 2.8 5.6 8.1-.9-2.6-3-3.9-5.8-3.9-2.6 0-4.8 1.3-5.7 4z" },
  {
    back: "M9.4 14.5c-.3-6.1 2.7-9.6 6.6-9.6s6.9 3.5 6.6 9.6v9.2c-1.5 1-3.4 1.4-4.6.9V15h-4v9.6c-1.2.5-3.1.1-4.6-.9z",
    front: "M10.4 13.8c.1-4.9 2.6-7.6 5.6-7.6 3.3 0 5.6 2.6 5.6 7.4-2.6-.4-5-1.9-6.4-4.1-.9 2.3-2.6 3.8-4.8 4.3z",
  },
  {
    back: "M9.6 15c-.4-6.3 2.7-9.7 6.4-9.7s6.8 3.4 6.4 9.7c.1 2.2-.4 3.6-1.4 4.4h-10c-1-.8-1.5-2.2-1.4-4.4z",
    front: "M10.4 14.2c-.2-5 2.4-8.1 5.6-8.1s5.8 3.1 5.6 8.1c-1.5-1.7-3.3-3.4-5.6-3.4s-4.1 1.7-5.6 3.4z",
  },
  {
    back: "M12.9 5.3a3.1 3.1 0 1 0 6.2 0 3.1 3.1 0 1 0-6.2 0z",
    front: "M10.4 13.5c-.4-4.8 2.4-7.3 5.6-7.3s6 2.5 5.6 7.3c-1.6-2.2-3.4-3.2-5.6-3.2s-4 1-5.6 3.2z",
  },
  {
    back: "M8.7 13.2a3 3 0 0 1 1.4-4.6 3 3 0 0 1 3.6-3.6 3 3 0 0 1 4.6 0 3 3 0 0 1 3.6 3.6 3 3 0 0 1 1.4 4.6 3 3 0 0 1-1.6 3.9c-.7-3.7-3.2-5.6-5.7-5.6s-5 1.9-5.7 5.6a3 3 0 0 1-1.6-3.9z",
  },
];



export function portraitOf(seed: number): { skin: number; hair: number; style: number } {
  return { skin: 1 + (Math.floor(seed / 8) % 5), hair: 1 + (Math.floor(seed / 40) % 5), style: Math.floor(seed / 200) % HAIR.length };
}

export function Portrait({ seed }: { seed: number }) {
  const { skin, hair, style } = portraitOf(seed);
  const { back, front } = HAIR[style];
  return (
    <svg
      viewBox="0 0 32 32"
      className="sender-art"
      style={{ "--skin": `var(--avatar-skin-${skin})`, "--hair": `var(--avatar-hair-${hair})` } as CSSProperties}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="portrait-ground" width="32" height="32" />
      {back && <path className="portrait-hair" d={back} />}
      <path className="portrait-shirt" d="M5 33c0-7.4 4.9-11.4 11-11.4S27 25.6 27 33z" />
      <path className="portrait-neck" d="M13.6 17.5h4.8v4.2a2.4 2.4 0 0 1-4.8 0z" />
      <ellipse className="portrait-skin" cx="16" cy="13.6" rx="5.6" ry="6.2" />
      {front && <path className="portrait-hair" d={front} />}
      <circle className="sender-art-rim" cx="16" cy="16" r="15.5" />
    </svg>
  );
}
