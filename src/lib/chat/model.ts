import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { requireServerEnv, serverEnv } from "@/lib/env";
import { ASSISTANT_NAME } from "@/lib/product";
import { simulatedModel } from "./simulated";

export const META_BASE_URL = "https://api.meta.ai/v1";
const META_CHAT_MODEL = "muse-spark-1.3";

export type ChatProvider = "meta" | "simulated" | "off";
export type LiveProvider = Exclude<ChatProvider, "off">;

export function chatProvider(): ChatProvider {
  const value = serverEnv("MODEL_PROVIDER");
  return value === "meta" || value === "simulated" ? value : "off";
}

export const AI_OFF_MESSAGE = `${ASSISTANT_NAME} is not available right now: messages, dictation and images cannot be sent to it. Everything else works as usual.`;

export function chatModel(provider: LiveProvider): { model: LanguageModel; providerOptions?: ProviderOptions } {
  if (provider === "simulated") return { model: simulatedModel() };
  const meta = createOpenAI({ baseURL: META_BASE_URL, apiKey: requireServerEnv("MODEL_API_KEY") });
  return {
    model: meta.responses(META_CHAT_MODEL),
    providerOptions: { openai: { store: false, include: ["reasoning.encrypted_content"] } },
  };
}
