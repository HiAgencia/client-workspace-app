import { chatProvider } from "@/lib/chat/model";
import { transcribe } from "@/lib/chat/transcribe";
import { capMessage, secondsToNextDay, takeUsageFor } from "@/lib/chat/usage";
import { isSupportedWav } from "@/lib/chat/wav";
import { serverEnv } from "@/lib/env";
import { json, problem, sameOrigin } from "@/lib/http";
import { currentUser, serviceClient, userClient } from "@/lib/supabase/server";

// About a minute and a half of 24 kHz mono 16-bit PCM: a voice note, not a meeting.
const MAX_AUDIO = 4 * 1024 * 1024;

// The probe: the microphone shows only when a transcription can actually run.
export async function GET() {
  const user = await currentUser(await userClient());
  if (!user) return problem(401, "not signed in");
  const available = chatProvider() === "simulated" || Boolean(serverEnv("MODEL_API_KEY"));
  return json({ ok: true, available });
}

// A voice note to text: the browser sends WAV, the cap is taken, and the transcript goes back to the input box.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO + 4096) return problem(413, "the note is too long");
  const user = await currentUser(await userClient());
  if (!user) return problem(401, "not signed in");
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
  const result = await transcribe(chatProvider(), bytes);
  if (!result.ok) return problem(result.status, result.message);
  return json({ ok: true, text: result.text });
}
