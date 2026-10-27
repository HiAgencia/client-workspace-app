import { chatProvider, type ChatProvider } from "./chat/model";

// What the running server says about itself: that it runs code, and which model the chat answers with, so a check that
// must not spend reads it from the server it talks to rather than from a file the server may not have loaded.
export type HealthStatus = { ok: true; chat: ChatProvider };

export function healthStatus(): HealthStatus {
  return { ok: true, chat: chatProvider() };
}
