"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
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

// The chat of the open node: one card the height of the window. It loads the stored conversation first, then hands it
// to the live chat; the conversation scrolls inside the card and the message box stays at its foot.
export function ChatPanel({ nodeId }: { nodeId: string }) {
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tree } = useWorkspace();
  const name = tree?.find((node) => node.id === nodeId)?.name;

  useEffect(() => {
    void get<{ messages: UIMessage[] }>(`/api/chat?node=${nodeId}`).then((answer) => {
      if (answer.ok) setInitial(answer.messages);
      else setError(answer.message);
    });
  }, [nodeId]);

  return (
    <section className="card chat" aria-labelledby="chat-title" data-chat>
      <div className="chat-head">
        <h2 id="chat-title" className="t-title">
          Chat
        </h2>
        <p className="t-meta">{name ? `It works on ${name} and what is below it.` : "It works on this project and what is below it."}</p>
      </div>
      {initial === null ? (
        <div className="chat-log" role="status" aria-busy="true" aria-label="Loading the conversation">
          {error ? (
            <p className="inline-note" data-tone="alert">
              The conversation could not be read: {error}. Reload the page to try again.
            </p>
          ) : (
            <>
              <span className="skeleton" style={{ width: "62%", height: "2.4rem", alignSelf: "flex-end" }} />
              <span className="skeleton" style={{ width: "80%" }} />
              <span className="skeleton" style={{ width: "54%" }} />
            </>
          )}
        </div>
      ) : (
        <Conversation nodeId={nodeId} initial={initial} />
      )}
    </section>
  );
}

function Conversation({ nodeId, initial }: { nodeId: string; initial: UIMessage[] }) {
  const { touch } = useWorkspace();
  const [input, setInput] = useState("");
  const [image, setImage] = useState<FileUIPart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { messages, sendMessage, status, error, clearError } = useChat({
    id: nodeId,
    messages: initial,
    // Only the new message travels; the server rebuilds the conversation from what it stored.
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { nodeId, timeZone, message: messages.at(-1) } }),
    }),
    // What the chat wrote shows in the node right away, without reloading.
    onFinish: () => touch(),
  });
  const busy = status === "submitted" || status === "streaming";

  // The view goes to the newest message, inside the conversation only: the page around it does not move.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [messages, busy]);

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy || (!input.trim() && !image)) return;
    clearError();
    setNotice(null);
    void sendMessage({ role: "user", parts: [...(image ? [image] : []), { type: "text", text: input.trim() || "Turn this into tasks." }] });
    setInput("");
    setImage(null);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
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
    <>
      <ol className="chat-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <li className="inline-note">
            Ask it to create a task, record a decision, or tell you what is pending here. A screenshot of a message becomes tasks.
          </li>
        )}
        {messages.map((message) => (
          <li key={message.id} data-role={message.role} className="msg">
            <span className="t-meta">{message.role === "user" ? "You" : "Assistant"}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return message.role === "user" ? (
                  <p key={index} className="msg-bubble msg-text t-value">
                    {part.text}
                  </p>
                ) : (
                  <p key={index} className="msg-text t-body">
                    {part.text}
                  </p>
                );
              }
              if (part.type === "file" && part.mediaType.startsWith("image/")) {
                return (
                  <p key={index} className="pill">
                    Image: {part.filename ?? "attached"}
                  </p>
                );
              }
              if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available") {
                return <ActionCard key={index} toolName={part.type.slice(5)} output={part.output as WriteOutput} />;
              }
              return null;
            })}
          </li>
        ))}
        {busy && (
          <li className="msg" aria-busy="true">
            <span className="t-meta">Assistant</span>
            <span className="typing" role="status" aria-label="Working…">
              <span />
              <span />
              <span />
            </span>
          </li>
        )}
      </ol>
      <form onSubmit={send} className="chat-compose">
        {error && (
          <p role="alert" className="inline-note" data-tone="alert" data-chat-error>
            {error.message.includes("limit") ? error.message : `The assistant could not answer: ${readable(error.message)}`}
          </p>
        )}
        {notice && (
          <p role="status" className="inline-note">
            {notice}
          </p>
        )}
        {image && (
          <p className="inline" data-attached>
            <span className="pill">Attached: {image.filename}</span>
            <Button variant="quiet" size="sm" onClick={() => setImage(null)}>
              Remove
            </Button>
          </p>
        )}
        <div className="compose-line">
          <TextArea
            aria-label="Message to the assistant"
            placeholder="Create a task to…"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Send
          </Button>
        </div>
        <div className="compose-actions">
          {/* The file input stays the real, focusable control; its label is the visible button, in the product's
              words rather than the browser's own "choose file" text. */}
          <label className={`${buttonClass({ size: "sm" })} file-button`}>
            <span className="btn-label">Attach an image</span>
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => attach(e.target.files?.[0])} />
          </label>
          <VoiceNote onText={(text) => setInput((current) => (current ? `${current} ${text}` : text))} onNotice={setNotice} />
        </div>
      </form>
    </>
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
// restored. Undoing goes through the same tools as everything else. The card keeps its box when it turns into
// "Undone", so nothing beside it moves.
function ActionCard({ toolName, output }: { toolName: string; output: WriteOutput }) {
  const { saving } = useWorkspace();
  const [undone, setUndone] = useState(false);
  if (!(toolName in DONE)) return null;
  if (!output?.ok || !output.item) {
    return (
      <p className="action-card t-help" data-card="failed">
        Could not {toolName.replace(/_/g, " ")}: {output?.message}
      </p>
    );
  }
  const item = output.item;

  async function undo() {
    let request;
    if (toolName === "delete_item") request = post(`/api/items/${item.id}/restore`, {});
    else if (toolName === "update_item" && output.previous) {
      const p = output.previous;
      // Every replaced value goes back, a link that was empty included (only a link item cannot lose its address).
      request = tool("update_item", {
        id: item.id,
        title: p.title,
        notes: p.body,
        priority: p.priority,
        dueOn: p.dueOn,
        status: p.status,
        ...(item.type === "link" && !p.url ? {} : { url: p.url }),
      });
    } else request = tool("delete_item", { id: item.id });
    if (await saving(request)) setUndone(true);
  }

  return (
    <div className="action-card" data-card={toolName}>
      <span className="t-value action-text">
        {DONE[toolName]} “{item.title}”
      </span>
      {undone ? (
        <span className="pill">Undone</span>
      ) : (
        <Button size="sm" onClick={() => void undo()}>
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
    // Its name says what the next press does, so it carries no pressed state.
    <Button size="sm" disabled={working} onClick={() => (recording ? recorder.current?.stop() : void start())}>
      {working ? "Transcribing…" : recording ? "Stop and transcribe" : "Voice note"}
    </Button>
  );
}
