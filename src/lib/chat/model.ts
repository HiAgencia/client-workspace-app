import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { requireServerEnv, serverEnv } from "@/lib/env";
import { simulatedModel } from "./simulated";

export const META_BASE_URL = "https://api.meta.ai/v1";
export const META_CHAT_MODEL = "muse-spark-1.3";

export type ChatProvider = "meta" | "simulated";

export function chatProvider(): ChatProvider {
  return serverEnv("MODEL_PROVIDER") === "meta" ? "meta" : "simulated";
}



export function chatModel(provider = chatProvider()): { model: LanguageModel; providerOptions?: ProviderOptions } {
  if (provider === "simulated") return { model: simulatedModel() };
  const meta = createOpenAI({ baseURL: META_BASE_URL, apiKey: requireServerEnv("MODEL_API_KEY") });
  return {
    model: meta.responses(META_CHAT_MODEL),
    providerOptions: { openai: { store: false, include: ["reasoning.encrypted_content"] } },
  };
}
