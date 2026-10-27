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

// The model sits behind one switch: `simulated` runs the scripted model with no spend, `meta` calls Muse Spark over
// the Responses API. With `store: false` Meta keeps nothing, so the encrypted reasoning travels back with each turn.
export function chatModel(provider = chatProvider()): { model: LanguageModel; providerOptions?: ProviderOptions } {
  if (provider === "simulated") return { model: simulatedModel() };
  const meta = createOpenAI({ baseURL: META_BASE_URL, apiKey: requireServerEnv("MODEL_API_KEY") });
  return {
    model: meta.responses(META_CHAT_MODEL),
    providerOptions: { openai: { store: false, include: ["reasoning.encrypted_content"] } },
  };
}
