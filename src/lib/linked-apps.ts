



export type LinkedApp =
  | "github"
  | "figma"
  | "docs"
  | "sheets"
  | "slides"
  | "drive"
  | "meet"
  | "calendar"
  | "gmail"
  | "analytics"
  | "notion"
  | "slack"
  | "youtube";


export const LINKED_APP_NAMES: Record<LinkedApp, string> = {
  github: "GitHub",
  figma: "Figma",
  docs: "Google Docs",
  sheets: "Google Sheets",
  slides: "Google Slides",
  drive: "Google Drive",
  meet: "Google Meet",
  calendar: "Google Calendar",
  gmail: "Gmail",
  analytics: "Google Analytics",
  notion: "Notion",
  slack: "Slack",
  youtube: "YouTube",
};


const GOOGLE_HOSTS = new Map<string, LinkedApp>([
  ["drive.google.com", "drive"],
  ["meet.google.com", "meet"],
  ["calendar.google.com", "calendar"],
  ["mail.google.com", "gmail"],
  ["analytics.google.com", "analytics"],
]);
const GOOGLE_EDITORS: Array<[string, LinkedApp]> = [
  ["/document/", "docs"],
  ["/spreadsheets/", "sheets"],
  ["/presentation/", "slides"],
];


const DOMAINS: Array<[string, LinkedApp]> = [
  ["github.com", "github"],
  ["figma.com", "figma"],
  ["notion.so", "notion"],
  ["notion.site", "notion"],
  ["slack.com", "slack"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
];

export function linkedApp(href: string): LinkedApp | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "docs.google.com") return GOOGLE_EDITORS.find(([path]) => url.pathname.startsWith(path))?.[1] ?? null;
  const google = GOOGLE_HOSTS.get(host);
  if (google) return google;
  return DOMAINS.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? null;
}
