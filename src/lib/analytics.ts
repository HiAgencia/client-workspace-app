type Params = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackDemoStart(where: string): void {
  send("demo_start", { where });
}

export function trackSignIn(where: string): void {
  send("sign_in", { where });
}

export function trackChatMessage(scoped: boolean): void {
  send("chat_message", { scoped });
}

export function trackNewChat(): void {
  send("new_chat");
}

export function trackDictation(): void {
  send("dictation");
}

export function trackImageAttach(): void {
  send("image_attach");
}

export function trackChatWrite(toolName: string): void {
  send("chat_write", { tool: toolName });
}

export function trackUndo(): void {
  send("undo");
}

export function trackTaskCreated(): void {
  send("task_created");
}

export function trackAccountConnect(): void {
  send("account_connect");
}

export function trackTokenIssued(): void {
  send("token_issued");
}

export function trackKeySaved(): void {
  send("key_saved");
}

export function trackSignOut(): void {
  send("sign_out");
}

function send(name: string, params: Params = {}): void {
  if (typeof window === "undefined") return;
  window.dataLayer ??= [];
  window.gtag ??=
    function gtag() {
      // eslint-disable-next-line prefer-rest-params -- gtag.js reads its queue's entries as argument lists and ignores plain arrays: the arguments object itself is what the real gtag stub pushes.
      window.dataLayer?.push(arguments as unknown as unknown[]);
    };
  try {
    window.gtag("event", name, params);
  } catch {
  }
}
