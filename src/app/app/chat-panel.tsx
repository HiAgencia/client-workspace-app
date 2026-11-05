"use client";

import { useChat } from "@ai-sdk/react";
import { trackChatMessage, trackChatWrite, trackDictation, trackImageAttach, trackNewChat, trackUndo } from "@/lib/analytics";
import { DefaultChatTransport, isToolUIPart, type FileUIPart, type UIMessage } from "ai";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { MetaMark } from "@/components/ui/brands";
import { Button, buttonClass } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { AttachImageIcon, CloseIcon, CopiedIcon, MicIcon, SendIcon, UndoIcon } from "@/components/ui/icons";
import { afterExit } from "@/components/ui/use-exit";
import { BROWSER_READS, leftUnfinished, turnGoesOn } from "@/lib/chat/browser-reads";
import { encodeWav, mixToMono, resample } from "@/lib/chat/wav";
import { inlinePieces } from "@/lib/inline-links";
import { ASSISTANT_MODELS, ASSISTANT_NAME } from "@/lib/product";
import { translateNow, useStrings } from "@/lib/strings";
import { PathText } from "./item-parts";
import { get, post, tool } from "./client-api";
import { onFocusRequest } from "./focus-request";
import { WRITES, type WriteOutput } from "./chat-cards";
import { useWorkspace } from "./workspace";
import "../styles/chat.css";

const DOCK_QUERY = "(width >= 80rem)";

function subscribeDock(onChange: () => void) {
  const query = window.matchMedia(DOCK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useDocked(): boolean {
  return useSyncExternalStore(subscribeDock, () => window.matchMedia(DOCK_QUERY).matches, () => true);
}

export function ChatDock() {
  const { t } = useStrings();
  const { chat } = useWorkspace();
  const docked = useDocked();
  const { setOpen } = chat;
  const dock = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => {
    const held = dock.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (held) requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-page-header] [data-chat-toggle]")?.focus({ preventScroll: true }));
  }, [setOpen]);
  const open = chat.scope !== undefined && chat.open;
  const [kept, setKept] = useState<{ scope: string | null; docked: boolean } | null>(null);
  if (open && (kept === null || kept.scope !== chat.scope || kept.docked !== docked)) setKept({ scope: chat.scope ?? null, docked });
  useEffect(() => {
    if (open || kept === null) return;
    return afterExit(kept.docked ? [dock.current, dock.current?.parentElement] : sheet.current, () => setKept(null));
  }, [open, kept]);
  if (kept === null) return null;
  const panel = <ChatPanel key={`chat-${kept.scope ?? "workspace"}`} nodeId={kept.scope} onClose={close} />;
  return kept.docked ? (
    <aside ref={dock} className="chat-dock" id="chat-panel" aria-label={t("chat.chat")} data-leaving={open ? undefined : ""}>
      {panel}
    </aside>
  ) : (
    <ChatSheet dialog={sheet} open={open} onClose={close}>
      {panel}
    </ChatSheet>
  );
}

function ChatSheet({ dialog, open, onClose, children }: { dialog: RefObject<HTMLDialogElement | null>; open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useStrings();
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [dialog, open]);
  useEffect(() => (open ? onFocusRequest(onClose) : undefined), [open, onClose]);
  return (
    <dialog
      ref={dialog}
      id="chat-panel"
      className="dialog panel chat-sheet"
      aria-label={t("chat.chat")}
      onClose={onClose}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.dataset.downOutside = "";
      }}
      onClick={(event) => {
        const sheet = event.currentTarget;
        if (event.target === sheet && sheet.dataset.downOutside !== undefined) onClose();
        delete sheet.dataset.downOutside;
      }}
    >
      {children}
    </dialog>
  );
}

const MAX_IMAGE = 4 * 1024 * 1024;

function ChatPanel({ nodeId, onClose }: { nodeId: string | null; onClose: () => void }) {
  const { t } = useStrings();
  const [initial, setInitial] = useState<{ messages: UIMessage[]; off: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [starting, setStarting] = useState(false);
  const [working, setWorking] = useState(false);
  const { tree } = useWorkspace();
  const node = nodeId ? tree?.find((entry) => entry.id === nodeId) : undefined;
  const below = node && tree?.some((entry) => entry.parentId === node.id) ? (node.kind === "client" ? t("chat.andProjects") : t("chat.andSubprojects")) : "";
  const reach = nodeId === null ? t("chat.worksAll") : node ? <>{t("chat.worksIn")} <PathText path={node.path} />{below}</> : t("chat.worksThisPage");

  useEffect(() => {
    void get<{ messages: UIMessage[]; off: string | null }>(nodeId ? `/api/chat?node=${nodeId}` : "/api/chat").then((answer) => {
      if (answer.ok) setInitial({ messages: answer.messages, off: answer.off });
      else setError(answer.message);
    });
  }, [nodeId]);

  return (
    <section className="card chat" aria-labelledby="chat-title" data-chat={nodeId ?? "workspace"} data-cascade>
      <div className="chat-head">
        <span className="chat-icon" aria-hidden="true">
          <MetaMark />
        </span>
        <div className="stack chat-title">
          <h2 id="chat-title" className="t-title">
            {ASSISTANT_NAME}
          </h2>
          <p className="t-meta chat-models">{ASSISTANT_MODELS}</p>
          <p className="t-value chat-reach">{reach}</p>
        </div>
        <Button
          size="sm"
          variant="quiet"
          data-chat-new
          disabled={initial === null || initial.off !== null || starting || working}
          onClick={() => {
            setStarting(true);
            setError(null);
            trackNewChat();
            void post<object>(nodeId ? `/api/chat?node=${nodeId}` : "/api/chat", {}, "DELETE")
              .then((answer) => {
                if (!answer.ok) return setError(answer.message);
                setInitial((now) => (now ? { ...now, messages: [] } : now));
                setRound((now) => now + 1);
              })
              .finally(() => setStarting(false));
          }}
        >
          <span className="btn-label">{starting ? t("chat.starting") : t("chat.clear")}</span>
        </Button>
        <Button size="sm" variant="quiet" className="btn-icon" onClick={onClose} data-chat-close title={t("chat.close")}>
          <CloseIcon />
          <span className="sr-only">{t("chat.close")}</span>
        </Button>
      </div>
      {initial === null ? (
        <div className="chat-log" role="status" aria-busy="true" aria-label={t("chat.loadingConversation")}>
          {error ? (
            <p className="inline-note" data-tone="alert">
              {t("chat.conversationNotLoaded", { message: error })}
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
        <>
          {error && (
            <p className="inline-note" data-tone="alert">
              {error}
            </p>
          )}
          <Conversation key={round} round={round} nodeId={nodeId} initial={initial.messages} off={initial.off} onBusy={setWorking} />
        </>
      )}
    </section>
  );
}

function Conversation({ round, nodeId, initial, off, onBusy }: { round: number; nodeId: string | null; initial: UIMessage[]; off: string | null; onBusy: (busy: boolean) => void }) {
  const { t, lang } = useStrings();
  const { touch } = useWorkspace();
  const [input, setInput] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const [image, setImage] = useState<FileUIPart | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [reading, setReading] = useState(0);
  const { messages, sendMessage, addToolOutput, status, error, clearError } = useChat({
    id: `${nodeId ?? "workspace"}:${round}`,
    messages: initial,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { nodeId, timeZone, message: messages.at(-1) } }),
    }),
    onToolCall: ({ toolCall }) => {
      if (!BROWSER_READS.has(toolCall.toolName)) return;
      setReading((now) => now + 1);
      void tool(toolCall.toolName, toolCall.input as Record<string, unknown>, nodeId)
        .then((output) => addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output }))
        .finally(() => setReading((now) => now - 1));
    },
    sendAutomaticallyWhen: turnGoesOn,
    onFinish: ({ message }) => {
      if (!message.parts.some((part) => isToolUIPart(part) && part.state === "input-available")) touch();
    },
  });
  const busy = status === "submitted" || status === "streaming" || reading > 0;
  useEffect(() => onBusy(busy), [busy, onBusy]);

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
    trackChatMessage(nodeId !== null);
    void sendMessage({ role: "user", parts: [...(image ? [image] : []), { type: "text", text: input.trim() || t("chat.turnIntoTasks") }] });
    setInput("");
    setImage(null);
    box.current?.focus({ preventScroll: true });
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function attach(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setNotice(t("chat.attachImageNotice"));
    if (file.size > MAX_IMAGE) return setNotice(t("chat.imageTooLarge"));
    trackImageAttach();
    const reader = new FileReader();
    reader.onload = () => setImage({ type: "file", mediaType: file.type, filename: file.name, url: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <>
      <ol className="chat-log" ref={log} aria-live="polite">
        {!off && (
          <li className="inline-note">
            {nodeId === null
              ? t("chat.askAll", { assistant: ASSISTANT_NAME })
              : t("chat.askHere", { assistant: ASSISTANT_NAME })}
          </li>
        )}
        {messages.map((message, at) => (
          <li key={message.id} data-role={message.role} className="msg">
            <span className="t-meta">{message.role === "user" ? t("chat.you") : ASSISTANT_NAME}</span>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return message.role === "user" ? (
                  <p key={index} className="msg-bubble msg-text t-value">
                    {part.text}
                  </p>
                ) : (
                  <p key={index} className="msg-bubble msg-text t-body">
                    {inlinePieces(part.text).map((piece, at) =>
                      piece.href ? (
                        <a key={at} href={piece.href} target="_blank" rel="noreferrer noopener">
                          {piece.text}
                        </a>
                      ) : (
                        <Fragment key={at}>{piece.text}</Fragment>
                      ),
                    )}
                  </p>
                );
              }
              if (part.type === "file" && part.mediaType.startsWith("image/")) {
                return part.url && at >= messages.length - 6 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the person's own attachment, already a data URL this browser holds: no optimizer to run.
                  <img key={index} className="msg-thumb" src={part.url} alt={part.filename ?? t("chat.attachedImage")} />
                ) : (
                  <p key={index} className="pill">{t("chat.imageAttached", { name: part.filename ?? t("chat.attachedFallback") })}</p>
                );
              }
              if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available") {
                return <ActionCard key={index} toolName={part.type.slice(5)} output={part.output as WriteOutput} />;
              }
              return null;
            })}
            {!busy && leftUnfinished(message) && (
              <p className="inline-note" data-chat-unfinished>
                {t("chat.unfinished")}
              </p>
            )}
          </li>
        ))}
        {(busy || messages.length > 0) && (
          <li className="msg msg-working" data-working={busy || undefined} aria-busy={busy || undefined} aria-hidden={!busy || undefined}>
            <span className="t-meta">{ASSISTANT_NAME}</span>
            <span className="typing" role={busy ? "status" : undefined} aria-label={busy ? t("chat.working") : undefined}>
              <span />
              <span />
              <span />
            </span>
          </li>
        )}
      </ol>
      {off ? (
        <div className="chat-compose">
          <p role="status" className="inline-note" data-chat-off>
            {off}
          </p>
        </div>
      ) : (
        <form onSubmit={send} className="chat-compose">
          {error && (
            <p role="alert" className="inline-note" data-tone="alert" data-chat-error>
              {error.message.includes("limit") ? error.message : t("chat.couldNotAnswer", { assistant: ASSISTANT_NAME, message: readable(error.message) })}
            </p>
          )}
          {notice && (
            <p role="status" className="inline-note">
              {notice}
            </p>
          )}
          {image && (
            <p className="inline attach-row" data-attached>
              {/* eslint-disable-next-line @next/next/no-img-element -- the same data URL, shown small before it is sent: no optimizer to run. */}
              <img className="attach-thumb" src={image.url} alt="" />
              <span className="pill">{image.filename}</span>
              <Button variant="quiet" size="sm" onClick={() => setImage(null)}>
                {t("chat.remove")}
              </Button>
            </p>
          )}
          <div className="compose-line">
            <TextArea
              ref={box}
              lang={lang}
              aria-label={t("chat.messageTo", { assistant: ASSISTANT_NAME })}
              placeholder={t("chat.askAssistant", { assistant: ASSISTANT_NAME })}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
            />
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
              <SendIcon />
              <span className="btn-label">{t("chat.send")}</span>
            </Button>
          </div>
          <div className="compose-actions">
            <label className={`${buttonClass({ size: "sm", variant: "quiet" })} file-button`}>
              <AttachImageIcon />
              <span className="btn-label">{t("chat.attachAnImage")}</span>
              <input id="chat-image" name="chat-image" type="file" accept="image/*" className="sr-only" onChange={(e) => attach(e.target.files?.[0])} />
            </label>
            <VoiceNote onText={(text) => setInput((current) => (current ? `${current} ${text}` : text))} onNotice={setNotice} />
          </div>
        </form>
      )}
    </>
  );
}

function readable(message: string): string {
  try {
    const parsed = JSON.parse(message) as { message?: string };
    return parsed.message ?? message;
  } catch {
    return message;
  }
}

function ActionCard({ toolName, output }: { toolName: string; output: WriteOutput }) {
  const { t } = useStrings();
  const { saving } = useWorkspace();
  const [undone, setUndone] = useState(false);
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || !output?.ok) return;
    counted.current = true;
    trackChatWrite(toolName);
  }, [output, toolName]);
  if (!(toolName in WRITES)) return null;
  const card = WRITES[toolName](output);
  if (!output?.ok) {
    return (
      <p className="action-card t-help" data-card="failed">
        {t("chat.couldNotDo", { message: output?.message ?? "" })}
      </p>
    );
  }
  if (!card) return null;

  async function undo() {
    if (card?.undo && (await saving(card.undo()))) {
      setUndone(true);
      trackUndo();
    }
  }

  return (
    <div className="action-card" data-card={toolName} data-undone={undone || undefined}>
      <span className="action-mark" aria-hidden="true">
        {undone ? <UndoIcon /> : <CopiedIcon />}
      </span>
      <span className="t-value action-text">{card.what}</span>
      {undone ? (
        <span className="pill">{t("chat.undone")}</span>
      ) : card.undo ? (
        <Button size="sm" variant="quiet" onClick={() => void undo()} aria-label={t("chat.undoNamed", { what: card.what })}>
          <UndoIcon />
          <span className="btn-label">{t("common.undo")}</span>
        </Button>
      ) : (
        card.why && <span className="t-meta action-sentence">{card.why}</span>
      )}
    </div>
  );
}


function VoiceNote({ onText, onNotice }: { onText: (text: string) => void; onNotice: (text: string) => void }) {
  const { t } = useStrings();
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      microphone.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (typeof MediaRecorder === "undefined") return;
    void get<{ available: boolean }>("/api/transcribe").then((answer) => setAvailable(answer.ok && answer.available));
  }, []);

  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => setSeconds((n) => n + 1), 1_000);
    return () => clearInterval(tick);
  }, [recording]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone.current = stream;
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (event) => chunks.push(event.data);
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        void finish(new Blob(chunks, { type: next.mimeType }));
      };
      next.start();
      recorder.current = next;
      setSeconds(0);
      setRecording(true);
      trackDictation();
    } catch {
      onNotice(translateNow("chat.micUnavailable"));
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
      if (!answer.ok) onNotice(answer.message ?? translateNow("chat.noteNotTranscribed"));
      else if (answer.text) onText(answer.text);
      else onNotice(translateNow("chat.nothingHeard"));
    } catch {
      onNotice(translateNow("chat.noteNotProcessed"));
    } finally {
      setWorking(false);
    }
  }

  if (!available) return null;
  if (recording) {
    return (
      <span className="inline rec-live" role="status" aria-label={t("chat.recording")}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="t-value">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
        <Button size="sm" variant="quiet" onClick={() => recorder.current?.stop()}>
          <span className="btn-label">{t("chat.stop")}</span>
        </Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant="quiet" disabled={working} onClick={() => void start()}>
      <MicIcon />
      <span className="btn-label">{working ? t("chat.transcribing") : t("chat.dictate")}</span>
    </Button>
  );
}
