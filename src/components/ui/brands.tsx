import { useId, type ReactElement, type ReactNode } from "react";
import { linkedApp, type LinkedApp } from "@/lib/linked-apps";
import { cx } from "@/lib/utils";
import { LinkIcon, MailIcon } from "./icons";







export type Mark = (props: { className?: string }) => ReactElement;

function Logo({ name, viewBox, className, children }: { name: string; viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} className={cx("icon logo", className)} data-logo={name} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}




export function GoogleMark({ className }: { className?: string }) {
  return (
    <Logo name="google" viewBox="0 0 48 48" className={className}>
      <path
        fill="var(--logo-google-red)"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="var(--logo-google-blue)"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="var(--logo-google-yellow)"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="var(--logo-google-green)"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Logo>
  );
}

export function GmailMark({ className }: { className?: string }) {
  return (
    <Logo name="gmail" viewBox="52 42 88 66" className={className}>
      <path fill="var(--logo-google-blue)" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="var(--logo-google-green)" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="var(--logo-gmail-yellow)" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="var(--logo-google-red)" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="var(--logo-gmail-red-deep)" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </Logo>
  );
}

export function GoogleCalendarMark({ className }: { className?: string }) {
  return (
    <Logo name="google-calendar" viewBox="-3.75 -3.75 200 200" className={className}>
      <path fill="var(--logo-calendar-page)" d="M148.882,43.618l-47.368-5.263l-57.895,5.263L38.355,96.25l5.263,52.632l52.632,6.579l52.632-6.579 l5.263-53.947L148.882,43.618z" />
      <path
        fill="var(--logo-calendar-blue)"
        d="M65.211,125.276c-3.934-2.658-6.658-6.539-8.145-11.671l9.132-3.763c0.829,3.158,2.276,5.605,4.342,7.342 c2.053,1.737,4.553,2.592,7.474,2.592c2.987,0,5.553-0.908,7.697-2.724s3.224-4.132,3.224-6.934c0-2.868-1.132-5.211-3.395-7.026 s-5.105-2.724-8.5-2.724h-5.276v-9.039H76.5c2.921,0,5.382-0.789,7.382-2.368c2-1.579,3-3.737,3-6.487 c0-2.447-0.895-4.395-2.684-5.855s-4.053-2.197-6.803-2.197c-2.684,0-4.816,0.711-6.395,2.145s-2.724,3.197-3.447,5.276 l-9.039-3.763c1.197-3.395,3.395-6.395,6.618-8.987c3.224-2.592,7.342-3.895,12.342-3.895c3.697,0,7.026,0.711,9.974,2.145 c2.947,1.434,5.263,3.421,6.934,5.947c1.671,2.539,2.5,5.382,2.5,8.539c0,3.224-0.776,5.947-2.329,8.184 c-1.553,2.237-3.461,3.947-5.724,5.145v0.539c2.987,1.25,5.421,3.158,7.342,5.724c1.908,2.566,2.868,5.632,2.868,9.211 s-0.908,6.776-2.724,9.579c-1.816,2.803-4.329,5.013-7.513,6.618c-3.197,1.605-6.789,2.421-10.776,2.421 C73.408,129.263,69.145,127.934,65.211,125.276z"
      />
      <path fill="var(--logo-calendar-blue)" d="M121.25,79.961l-9.974,7.25l-5.013-7.605l17.987-12.974h6.895v61.197h-9.895L121.25,79.961z" />
      <path fill="var(--logo-google-red)" d="M148.882,196.25l47.368-47.368l-23.684-10.526l-23.684,10.526l-10.526,23.684L148.882,196.25z" />
      <path fill="var(--logo-google-green)" d="M33.092,172.566l10.526,23.684h105.263v-47.368H43.618L33.092,172.566z" />
      <path fill="var(--logo-google-blue)" d="M12.039-3.75C3.316-3.75-3.75,3.316-3.75,12.039v136.842l23.684,10.526l23.684-10.526V43.618h105.263 l10.526-23.684L148.882-3.75H12.039z" />
      <path fill="var(--logo-calendar-green-deep)" d="M-3.75,148.882v31.579c0,8.724,7.066,15.789,15.789,15.789h31.579v-47.368H-3.75z" />
      <path fill="var(--logo-gmail-yellow)" d="M148.882,43.618v105.263h47.368V43.618l-23.684-10.526L148.882,43.618z" />
      <path fill="var(--logo-calendar-blue-deep)" d="M196.25,43.618V12.039c0-8.724-7.066-15.789-15.789-15.789h-31.579v47.368H196.25z" />
    </Logo>
  );
}


const PAGE = "M58,88H6c-3.3,0-6-2.7-6-6V6c0-3.3,2.7-6,6-6h36l22,22v60C64,85.3,61.3,88,58,88z";
const FOLD = "M42,0l22,22H42V0z";

export function GoogleDocsMark({ className }: { className?: string }) {
  return (
    <Logo name="google-docs" viewBox="0 0 64 88" className={className}>
      <path fill="var(--logo-docs)" d={PAGE} />
      <path fill="var(--logo-docs-fold)" d={FOLD} />
      <path fill="var(--logo-page-ink)" d="M50,39H14v-5h36V39z M50,46H14v5h36V46z M40,58H14v5h26V58z" />
    </Logo>
  );
}

export function GoogleSheetsMark({ className }: { className?: string }) {
  return (
    <Logo name="google-sheets" viewBox="0 0 64 88" className={className}>
      <path fill="var(--logo-sheets-fold)" d="M42,0L64,22L53,24L42,22L40,11Z" />
      <path fill="var(--logo-sheets)" d="M42,22V0H6C2.685,0,0,2.685,0,6v76c0,3.315,2.685,6,6,6h52c3.315,0,6-2.685,6-6V22Z" />
      <path
        fill="var(--logo-page-ink)"
        d="M12,34V63H52V34Z M29.5,58H17v-7h12.5z m0,-12H17V39H29.5Z M47,58H34.5V51H47Z M47,46H34.5V39H47Z"
      />
    </Logo>
  );
}

export function GoogleSlidesMark({ className }: { className?: string }) {
  return (
    <Logo name="google-slides" viewBox="0 0 64 88" className={className}>
      <path fill="var(--logo-slides)" d={PAGE} />
      <path fill="var(--logo-slides-fold)" d={FOLD} />
      <path fill="var(--logo-page-ink)" d="M12,34.5v28h40v-28H12z M47,57.5H17v-18h30V57.5z" />
    </Logo>
  );
}

export function GoogleDriveMark({ className }: { className?: string }) {
  return (
    <Logo name="google-drive" viewBox="0 0 87.3 78" className={className}>
      <path fill="var(--logo-drive-blue-deep)" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="var(--logo-drive-green)" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" />
      <path fill="var(--logo-google-red)" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="var(--logo-drive-green-deep)" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="var(--logo-drive-blue)" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="var(--logo-drive-yellow)" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </Logo>
  );
}

export function GoogleMeetMark({ className }: { className?: string }) {
  return (
    <Logo name="google-meet" viewBox="0 0 87.5 72" className={className}>
      <path fill="var(--logo-drive-green-deep)" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
      <path fill="var(--logo-drive-blue-deep)" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
      <path fill="var(--logo-meet-red)" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
      <path fill="var(--logo-drive-blue)" d="M20.5 20.5H0v31h20.5z" />
      <path
        fill="var(--logo-drive-green)"
        d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z"
      />
      <path fill="var(--logo-drive-yellow)" d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z" />
    </Logo>
  );
}

export function GoogleAnalyticsMark({ className }: { className?: string }) {
  return (
    <Logo name="google-analytics" viewBox="0 0 192 192" className={className}>
      <path fill="var(--logo-analytics)" d="M130,29v132c0,14.77,10.19,23,21,23c10,0,21-7,21-23V30c0-13.54-10-22-21-22S130,17.33,130,29z" />
      <path fill="var(--logo-analytics-deep)" d="M75,96v65c0,14.77,10.19,23,21,23c10,0,21-7,21-23V97c0-13.54-10-22-21-22S75,84.33,75,96z" />
      <circle fill="var(--logo-analytics-deep)" cx="41" cy="163" r="21" />
    </Logo>
  );
}



export function GitHubMark({ className }: { className?: string }) {
  return (
    <Logo name="github" viewBox="0 0 16 16" className={className}>
      <path
        fill="var(--logo-github)"
        d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
      />
    </Logo>
  );
}

export function FigmaMark({ className }: { className?: string }) {
  return (
    <Logo name="figma" viewBox="0 0 200 300" className={className}>
      <path fill="var(--logo-figma-green)" d="M50 300c27.6 0 50-22.4 50-50v-50H50c-27.6 0-50 22.4-50 50s22.4 50 50 50z" />
      <path fill="var(--logo-figma-violet)" d="M0 150c0-27.6 22.4-50 50-50h50v100H50c-27.6 0-50-22.4-50-50z" />
      <path fill="var(--logo-figma-red)" d="M0 50C0 22.4 22.4 0 50 0h50v100H50C22.4 100 0 77.6 0 50z" />
      <path fill="var(--logo-figma-coral)" d="M100 0h50c27.6 0 50 22.4 50 50s-22.4 50-50 50h-50V0z" />
      <path fill="var(--logo-figma-blue)" d="M200 150c0 27.6-22.4 50-50 50s-50-22.4-50-50 22.4-50 50-50 50 22.4 50 50z" />
    </Logo>
  );
}


export function NotionMark({ className }: { className?: string }) {
  return (
    <Logo name="notion" viewBox="0 0 100 100" className={className}>
      <path
        fill="var(--logo-notion-page)"
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
      />
      <path
        fill="var(--logo-notion-ink)"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
      />
    </Logo>
  );
}

export function SlackMark({ className }: { className?: string }) {
  return (
    <Logo name="slack" viewBox="0 0 127 127" className={className}>
      <path
        fill="var(--logo-slack-red)"
        d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
      />
      <path
        fill="var(--logo-slack-blue)"
        d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
      />
      <path
        fill="var(--logo-slack-green)"
        d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
      />
      <path
        fill="var(--logo-slack-yellow)"
        d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
      />
    </Logo>
  );
}

export function YouTubeMark({ className }: { className?: string }) {
  return (
    <Logo name="youtube" viewBox="0 0 28.57 20" className={className}>
      <path
        fill="var(--logo-youtube)"
        d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 0 14.285 0 14.285 0C14.285 0 5.35042 0 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C0 5.35042 0 10 0 10C0 10 0 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z"
      />
      <path fill="var(--logo-youtube-play)" d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z" />
    </Logo>
  );
}

const LINKED: Record<LinkedApp, Mark> = {
  github: GitHubMark,
  figma: FigmaMark,
  docs: GoogleDocsMark,
  sheets: GoogleSheetsMark,
  slides: GoogleSlidesMark,
  drive: GoogleDriveMark,
  meet: GoogleMeetMark,
  calendar: GoogleCalendarMark,
  gmail: GmailMark,
  analytics: GoogleAnalyticsMark,
  notion: NotionMark,
  slack: SlackMark,
  youtube: YouTubeMark,
};



export function LinkMark({ href, className }: { href: string; className?: string }) {
  const app = linkedApp(href);
  const Glyph: Mark = app ? LINKED[app] : href.startsWith("mailto:") ? MailIcon : LinkIcon;
  return <Glyph className={cx("link-mark", className)} />;
}





export function MetaMark({ className }: { className?: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  const loop = `${id}-meta-loop`;
  const rise = `${id}-meta-rise`;
  return (
    <Logo name="meta" viewBox="0 0 287.56 191" className={className}>
      <defs>
        <linearGradient id={loop} x1="61" y1="117" x2="259" y2="127" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--logo-meta-deep)" />
          <stop offset="0.4" stopColor="var(--logo-meta-deep)" />
          <stop offset="0.83" stopColor="var(--logo-meta-mid)" />
          <stop offset="1" stopColor="var(--logo-meta-light)" />
        </linearGradient>
        <linearGradient id={rise} x1="45" y1="139" x2="45" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--logo-meta-light)" />
          <stop offset="1" stopColor="var(--logo-meta-deeper)" />
        </linearGradient>
      </defs>
      <path
        fill="var(--logo-meta)"
        d="m31.06,125.96c0,10.98 2.41,19.41 5.56,24.51 4.13,6.68 10.29,9.51 16.57,9.51 8.1,0 15.51-2.01 29.79-21.76 11.44-15.83 24.92-38.05 33.99-51.98l15.36-23.6c10.67-16.39 23.02-34.61 37.18-46.96 11.56-10.08 24.03-15.68 36.58-15.68 21.07,0 41.14,12.21 56.5,35.11 16.81,25.08 24.97,56.67 24.97,89.27 0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75l0-31.02c17.63,0 22.03-16.2 22.03-34.74 0-26.42-6.16-55.74-19.73-76.69-9.63-14.86-22.11-23.94-35.84-23.94-14.85,0-26.8,11.2-40.23,31.17-7.14,10.61-14.47,23.54-22.7,38.13l-9.06,16.05c-18.2,32.27-22.81,39.62-31.91,51.75-15.95,21.24-29.57,29.29-47.5,29.29-21.27,0-34.72-9.21-43.05-23.09-6.8-11.31-10.14-26.15-10.14-43.06z"
      />
      <path
        fill={`url(#${loop})`}
        d="m24.49,37.3c14.24-21.95 34.79-37.3 58.36-37.3 13.65,0 27.22,4.04 41.39,15.61 15.5,12.65 32.02,33.48 52.63,67.81l7.39,12.32c17.84,29.72 27.99,45.01 33.93,52.22 7.64,9.26 12.99,12.02 19.94,12.02 17.63,0 22.03-16.2 22.03-34.74l27.4-.86c0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75-12.8,0-24.14-2.78-36.68-14.61-9.64-9.08-20.91-25.21-29.58-39.71l-25.79-43.08c-12.94-21.62-24.81-37.74-31.68-45.04-7.39-7.85-16.89-17.33-32.05-17.33-12.27,0-22.69,8.61-31.41,21.78z"
      />
      <path
        fill={`url(#${rise})`}
        d="m82.35,31.23c-12.27,0-22.69,8.61-31.41,21.78-12.33,18.61-19.88,46.33-19.88,72.95 0,10.98 2.41,19.41 5.56,24.51l-26.48,17.44c-6.8-11.31-10.14-26.15-10.14-43.06 0-30.75 8.44-62.8 24.49-87.55 14.24-21.95 34.79-37.3 58.36-37.3z"
      />
    </Logo>
  );
}


export function McpMark({ className }: { className?: string }) {
  return (
    <Logo name="mcp" viewBox="18.5 16.5 156 174" className={className}>
      <g fill="none" stroke="var(--logo-mcp)" strokeWidth="12" strokeLinecap="round">
        <path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177" />
        <path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.52" />
        <path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087V131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822" />
      </g>
    </Logo>
  );
}
