import { chatProvider, type ChatProvider } from "./chat/model";



export type HealthStatus = { ok: true; chat: ChatProvider };

export function healthStatus(): HealthStatus {
  return { ok: true, chat: chatProvider() };
}
