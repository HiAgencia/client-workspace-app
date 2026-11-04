import { AI_OFF_MESSAGE, chatProvider } from "@/lib/chat/model";
import { transcribe } from "@/lib/chat/transcribe";
import { capMessage, secondsToNextDay, takeUsageFor } from "@/lib/chat/usage";
import { isSupportedWav } from "@/lib/chat/wav";
import { serverEnv } from "@/lib/env";
import { json, problem, sameOrigin } from "@/lib/http";
import { requireUser, serviceClient, userClient } from "@/lib/supabase/server";

const MAX_AUDIO = 4 * 1024 * 1024;

export async function GET() {
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const provider = chatProvider();
  const available = provider === "simulated" || (provider === "meta" && Boolean(serverEnv("MODEL_API_KEY")));
  return json({ ok: true, available });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const provider = chatProvider();
  if (provider === "off") return json({ ok: false, code: "off", message: AI_OFF_MESSAGE }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO + 4096) return problem(413, "the note is too long");
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const { user } = who;
  let audio: File | null;
  try {
    const form = await request.formData();
    const value = form.get("audio");
    audio = value instanceof File ? value : null;
  } catch {
    return problem(400, "send the note as a form with its audio");
  }
  if (!audio) return problem(400, "send the note as a form with its audio");
  if (audio.size > MAX_AUDIO) return problem(413, "the note is too long");
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (!isSupportedWav(bytes)) return problem(415, "the note must be mono 16-bit WAV at 16 or 24 kHz");

  const taken = await takeUsageFor(serviceClient(), user, "transcription");
  if (!taken.allowed) {
    if (taken.reason === "error") return problem(503, "transcription is unavailable right now: try again");
    return json({ ok: false, code: "cap", message: capMessage(taken.reason, "transcription") }, 429, {
      "Retry-After": String(secondsToNextDay()),
    });
  }
  const result = await transcribe(provider, bytes);
  if (!result.ok) return problem(result.status, result.message);
  return json({ ok: true, text: result.text });
}
