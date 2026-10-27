import { requireServerEnv } from "@/lib/env";
import { META_BASE_URL, type ChatProvider } from "./model";

export const VOICE_MODEL = "muse-voice-transcribe-1.0";
// A voice note is short; the endpoint itself takes up to ten minutes, and the wait is bounded well below that.
const TIMEOUT_MS = 30_000;

export type Transcript = { ok: true; text: string } | { ok: false; status: number; message: string };

// The simulated provider answers with a fixed request, so the voice flow is built and tested without spend.
export const SIMULATED_TRANSCRIPT = "Create a task to call the client back about the invoice";

export async function transcribe(provider: ChatProvider, wav: Uint8Array<ArrayBuffer>, fetcher: typeof fetch = fetch): Promise<Transcript> {
  if (provider === "simulated") return { ok: true, text: SIMULATED_TRANSCRIPT };
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ model: VOICE_MODEL, mode: "PUSH_TO_TALK", audioEncoding: "WAV" })], { type: "application/json" }),
  );
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "note.wav");
  let response: Response;
  try {
    response = await fetcher(`${META_BASE_URL}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireServerEnv("MODEL_API_KEY")}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("transcribe: no answer", error instanceof Error ? error.name : error);
    return { ok: false, status: 504, message: "The transcription did not answer in time. Try again." };
  }
  if (!response.ok) {
    console.error("transcribe: HTTP", response.status, (await response.text()).slice(0, 300));
    return { ok: false, status: response.status === 429 ? 429 : 502, message: "The note could not be transcribed. Try again." };
  }
  const answer = (await response.json()) as { transcript?: string };
  // Silence comes back as an empty or whitespace transcript, which is dropped rather than sent.
  return { ok: true, text: (answer.transcript ?? "").trim() };
}
