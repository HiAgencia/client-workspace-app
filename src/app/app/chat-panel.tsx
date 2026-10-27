"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { encodeWav, mixToMono, resample } from "@/lib/chat/wav";
import { get, post, tool } from "./client-api";
import { useWorkspace } from "./workspace";

const MAX_IMAGE = 4 * 1024 * 1024;

type WriteOutput = {
  ok: boolean;
  message?: string;
  item?: { id: string; title: string; type: string };
  previous?: { title: string; body: string | null; url: string | null; priority: number | null; dueOn: string | null; status: string };
};

const DONE: Record<string, string> = {
  create_task: "Created task",
  add_decision: "Recorded decision",
  add_link: "Saved link",
  add_review: "Added to review",
  update_item: "Changed",
  delete_item: "Deleted",
};

// The chat of the open node. It loads the stored conversation first, then hands it to the live chat.
export function ChatPanel({ nodeId }: { nodeId: string }) {
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<{ messages: UIMessage[] }>(`/api/chat?node=${nodeId}`).then((answer) => {
      if (answer.ok) setInitial(answer.messages);
      else setError(answer.message);
    });
  }, [nodeId]);

  return (
    <aside className="flex flex-col gap-3 border-t pt-4 lg:w-96 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4" aria-label="Chat" data-chat>
      <h2 className="font-semibold">Chat</h2>
      {initial === null ? (
        <p aria-busy="true">{error ? `The conversation could not be read: ${error}` : "Loading the conversation…"}</p>
      ) : (
        <Conversation nodeId={nodeId} initial={initial} />
      )}
    </aside>
  );
}

function Conversation({ nodeId, initial }: { nodeId: string; initial: UIMessage[] }) {
  const { touch } = useWorkspace();
  const [input, setInput] = useState("");
  const [image, setImage] = useState<FileUIPart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { messages, sendMessage, status, error, clearError } = useChat({
    id: nodeId,
    messages: initial,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { nodeId, timeZone } }),
    // What the chat wrote shows in the node right away, without reloading.
    onFinish: () => touch(),
  });
  const busy = status === "submitted" || status === "streaming";

  function send(event: FormEvent) {
    event.preventDefault();
    if (busy || (!input.trim() && !image)) return;
    clearError();
    void sendMessage({ role: "user", parts: [...(image ? [image] : []), { type: "text", text: input.trim() || "Turn this into tasks." }] });
    setInput("");
    setImage(null);
  }

  function attach(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setNotice("Attach an image: a screenshot or a photo.");
    if (file.size > MAX_IMAGE) return setNotice("That image is too large. Attach one under 4 MB.");
    const reader = new FileReader();
    reader.onload = () => setImage({ type: "file", mediaType: file.type, filename: file.name, url: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3" aria-live="polite">
        {messages.length === 0 && <li>Ask for a task, a decision, or what is pending here.</li>}
        {messages.map((message) => (
          <li key={message.id} data-role={message.role} className="flex flex-col gap-1">
            <span className="font-semibold">{message.role === "user" ? "You" : "Assistant"}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") return <p key={index}>{part.text}</p>;
              if (part.type === "file" && part.mediaType.startsWith("image/")) return <p key={index}>Image: {part.filename ?? "attached"}</p>;
              if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available") {
                return <ActionCard key={index} toolName={part.type.slice(5)} output={part.output as WriteOutput} />;
              }
              return null;
            })}
          </li>
        ))}
        {busy && <li aria-busy="true">Working…</li>}
      </ol>
      {error && (
        <p role="alert" data-chat-error>
          {error.message.includes("limit") ? error.message : `The assistant could not answer: ${readable(error.message)}`}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={send} className="flex flex-col gap-2">
        {image && (
          <p data-attached>
            Attached: {image.filename}{" "}
            <Button type="button" variant="ghost" size="sm" onClick={() => setImage(null)}>
              Remove
            </Button>
          </p>
        )}
        <Input aria-label="Message to the assistant" placeholder="Create a task to…" value={input} onChange={(e) => setInput(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            Send
          </Button>
          <label className="flex items-center gap-2">
            <span>Image</span>
            <input type="file" accept="image/*" aria-label="Attach an image" onChange={(e) => attach(e.target.files?.[0])} />
          </label>
          <VoiceNote onText={(text) => setInput((current) => (current ? `${current} ${text}` : text))} onNotice={setNotice} />
        </div>
      </form>
    </div>
  );
}

// The server answers a refused turn with JSON; the panel shows its sentence, not the raw body.
function readable(message: string): string {
  try {
    const parsed = JSON.parse(message) as { message?: string };
    return parsed.message ?? message;
  } catch {
    return message;
  }
}

// What the chat did, with its undo: a creation is deleted, a change gets its previous values back, a deletion is
// restored. Undoing goes through the same tools as everything else.
function ActionCard({ toolName, output }: { toolName: string; output: WriteOutput }) {
  const { saving } = useWorkspace();
  const [undone, setUndone] = useState(false);
  if (!(toolName in DONE)) return null;
  if (!output?.ok || !output.item) return <p data-card="failed">Could not {toolName.replace(/_/g, " ")}: {output?.message}</p>;
  const item = output.item;

  async function undo() {
    let request;
    if (toolName === "delete_item") request = post(`/api/items/${item.id}/restore`, {});
    else if (toolName === "update_item" && output.previous) {
      const p = output.previous;
      request = tool("update_item", { id: item.id, title: p.title, notes: p.body, priority: p.priority, dueOn: p.dueOn, status: p.status, ...(p.url ? { url: p.url } : {}) });
    } else request = tool("delete_item", { id: item.id });
    if (await saving(request)) setUndone(true);
  }

  return (
    <div className="flex items-center gap-2 rounded border p-2" data-card={toolName}>
      <span>
        {DONE[toolName]} &ldquo;{item.title}&rdquo;
      </span>
      {undone ? (
        <span>Undone</span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void undo()}>
          Undo
        </Button>
      )}
    </div>
  );
}

// Push to talk: the browser records, the note becomes 24 kHz mono 16-bit WAV, and the transcript lands in the box
// to be reviewed before sending. The microphone shows only when the server can transcribe.
function VoiceNote({ onText, onNotice }: { onText: (text: string) => void; onNotice: (text: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (typeof MediaRecorder === "undefined") return;
    void get<{ available: boolean }>("/api/transcribe").then((answer) => setAvailable(answer.ok && answer.available));
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (event) => chunks.push(event.data);
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void finish(new Blob(chunks, { type: next.mimeType }));
      };
      next.start();
      recorder.current = next;
      setRecording(true);
    } catch {
      onNotice("The microphone is not available: allow it in the browser to record a note.");
    }
  }

  async function finish(blob: Blob) {
    setRecording(false);
    setWorking(true);
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      await context.close();
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      const wav = encodeWav(resample(mixToMono(channels), decoded.sampleRate));
      const form = new FormData();
      form.append("audio", new Blob([wav], { type: "audio/wav" }), "note.wav");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const answer = (await response.json()) as { ok: boolean; text?: string; message?: string };
      if (!answer.ok) onNotice(answer.message ?? "The note could not be transcribed.");
      else if (answer.text) onText(answer.text);
      else onNotice("Nothing was heard in that note.");
    } catch {
      onNotice("The note could not be processed. Try again.");
    } finally {
      setWorking(false);
    }
  }

  if (!available) return null;
  return (
    <Button type="button" variant="outline" disabled={working} onClick={() => (recording ? recorder.current?.stop() : void start())} aria-pressed={recording}>
      {working ? "Transcribing…" : recording ? "Stop and transcribe" : "Voice note"}
    </Button>
  );
}
