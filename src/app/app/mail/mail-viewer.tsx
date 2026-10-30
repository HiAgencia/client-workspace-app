"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePiece } from "@/components/ui/use-piece";
import { LOCALE } from "@/lib/dates";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import type { MailRow } from "@/lib/tools/mail-schema";
import { tool } from "../client-api";
import { documentFor } from "./mail-document";
import { subjectOf } from "./subject";
import { PlaceName } from "../task-row";
import { useSwap } from "../use-swap";

// A message whole, as `get_mail` gives it: its HTML already cleaned by the server, how many images it would fetch,
// and the language it declares, if any.
export type MailContent = MailRow & { html: string; text: string | null; remoteImages: number; language: string | null };

// ---- What the viewer remembers ----------------------------------------------------------------------------------------
// The mail's colors open in the product's theme or in the last one chosen here; the images of a sender load on their own
// once the person asked for them.

const MODE_KEY = "client-workspace:mail-mode";
const IMAGES_KEY = "client-workspace:mail-images";
const STORE_EVENT = "client-workspace:mail-viewer";

function subscribeStore(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}
const storedMode = (): Theme | null => {
  const value = localStorage.getItem(MODE_KEY);
  return value === "light" || value === "dark" ? value : null;
};
function imageSenders(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(IMAGES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
function remember(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(STORE_EVENT));
}

// ---- The viewer -------------------------------------------------------------------------------------------------------

const fullTime = (iso: string) =>
  new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type ViewerProps = {
  // The row from the list, painted at once; the whole message is read for it.
  row: MailRow;
  // «Previous» and «Next» through the list it came from; null at its ends.
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  // The actions on the message and what it is linked to, which the page owns.
  actions: ReactNode;
  // On a phone, the way back to the list.
  onClose?: () => void;
  // The message read, for whoever needs its content (the page's actions).
  onLoaded?: (message: MailContent | null) => void;
};

export function MailViewer({ row, onPrevious, onNext, actions, onClose, onLoaded }: ViewerProps) {
  const key = `${row.accountId}:${row.id}`;
  const [read, setRead] = useState<{ key: string; message: MailContent | null; error: string | null } | null>(null);
  const productTheme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as Theme);
  const chosen = useSyncExternalStore(subscribeStore, storedMode, () => null);
  const senders = useSyncExternalStore(subscribeStore, () => localStorage.getItem(IMAGES_KEY) ?? "[]", () => "[]");
  const mode: Theme = chosen ?? productTheme;
  const sender = row.from.email.toLowerCase();
  const imagesOn = imageSenders().includes(sender);
  void senders;

  useEffect(() => {
    let live = true;
    void tool<{ message: MailContent }>("get_mail", { account: row.accountId, id: row.id }).then((answer) => {
      if (!live) return;
      setRead({ key, message: answer.ok ? answer.message : null, error: answer.ok ? null : answer.message });
    });
    return () => {
      live = false;
    };
  }, [key, row.accountId, row.id]);

  const message = read?.key === key ? read.message : null;
  useEffect(() => {
    onLoaded?.(message);
  }, [message, onLoaded]);

  const setMode = (next: Theme) => remember(MODE_KEY, next);
  const setImages = (on: boolean) => {
    const list = imageSenders().filter((entry) => entry !== sender);
    remember(IMAGES_KEY, JSON.stringify(on ? [...list, sender] : list));
  };

  return (
    <article className="mail-viewer" aria-labelledby="mail-subject" data-mail-viewer={key}>
      <header className="mail-head">
        <div className="mail-head-top">
          <h2 id="mail-subject" className="t-title mail-subject" tabIndex={-1}>
            {subjectOf(row)}
          </h2>
          <div className="mail-head-tools">
            <ModeSwitch value={mode} onChange={setMode} />
          </div>
        </div>
        <p className="mail-from-line">
          <span className="t-name">{row.from.name ?? row.from.email}</span>
          {row.from.name && <span className="t-meta mail-address">{row.from.email}</span>}
        </p>
        <p className="t-meta mail-to-line">
          To <span className="mail-address">{row.accountEmail}</span>, {fullTime(row.receivedAt)}
        </p>
        <p className="t-meta mail-place-line">
          {row.place ? (
            <>
              In <PlaceName path={row.place.path} color={row.place.color} />
            </>
          ) : (
            "In no client or project"
          )}
          {row.important && (
            <span className="pill" data-tone="warn">
              Important
            </span>
          )}
        </p>
        <div className="mail-steps" role="group" aria-label="Move through the list">
          <Button size="sm" onClick={onPrevious ?? undefined} disabled={!onPrevious} aria-label={onPrevious ? "Previous message" : "Previous message: this is the first one"}>
            Previous
          </Button>
          <Button size="sm" onClick={onNext ?? undefined} disabled={!onNext} aria-label={onNext ? "Next message" : "Next message: this is the last one"}>
            Next
          </Button>
          {onClose && (
            <Button size="sm" onClick={onClose}>
              Back to the list
            </Button>
          )}
        </div>
      </header>

      {message && message.remoteImages > 0 && (
        <div className="mail-images" data-mail-images={imagesOn ? "shown" : "held"}>
          <p className="t-help">
            {imagesOn
              ? `The images of ${row.from.email} load on their own.`
              : `${message.remoteImages === 1 ? "1 image waits" : `${message.remoteImages} images wait`} to load: an image from the network tells the sender the message was opened.`}
          </p>
          <Button size="sm" onClick={() => setImages(!imagesOn)} data-show-images={imagesOn ? undefined : ""}>
            {imagesOn ? "Stop loading images" : "Show images"}
          </Button>
        </div>
      )}

      <div className="mail-actions">{actions}</div>

      {read?.key === key && read.error ? (
        <p role="alert" className="inline-note" data-tone="alert">
          This message could not be read: {read.error}
        </p>
      ) : (
        <MailFrame message={message} messageKey={key} mode={mode} images={imagesOn} />
      )}
    </article>
  );
}

// «Light | Dark»: the colors the message is read in. Each is a pressed button; the piece travels to the chosen one.
function ModeSwitch({ value, onChange }: { value: Theme; onChange: (value: Theme) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  usePiece(rail, '[aria-pressed="true"]');
  return (
    <div ref={rail} role="group" aria-label="Mail colors" className="seg mail-mode" data-mail-mode={value}>
      {(["light", "dark"] as const).map((option) => (
        <button key={option} type="button" className="seg-option" aria-pressed={option === value} onClick={() => onChange(option)}>
          {option === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

// The frame: the message at the width of the screen that reads it, and scaled down whole when its design is wider, never
// scrolled sideways. Its height is the message's, so the viewer around it is what scrolls; another message, mode or set
// of images leaves before the next one enters.
function MailFrame({ message, messageKey, mode, images }: { message: MailContent | null; messageKey: string; mode: Theme; images: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const built = message ? documentFor(message, mode, images) : null;
  const swapKey = message ? `${messageKey}:${mode}:${images ? "images" : "held"}` : "none";
  const { shown, shownKey, leaving } = useSwap(built, swapKey);
  const [fit, setFit] = useState<{ key: string; width: number; height: number; scale: number } | null>(null);
  const ready = fit?.key === shownKey;

  const measure = useCallback(() => {
    const element = frame.current;
    const box = host.current;
    const doc = element?.contentDocument;
    if (!element || !box || !doc?.documentElement) return;
    // The width inside the frame's own inset (the dark mode's), so the paper is what takes the reader's width.
    const style = getComputedStyle(box);
    const available = Math.floor(box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    if (available <= 0) return;
    element.style.width = `${available}px`;
    const natural = Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0);
    const width = Math.max(available, natural);
    element.style.width = `${width}px`;
    const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    setFit({ key: shownKey, width, height, scale: Math.min(1, available / width) });
    // The frame is as tall as its message and never scrolls: the wheel over it moves what holds it, the viewer.
    if (!doc.documentElement.dataset.wheel) {
      doc.documentElement.dataset.wheel = "";
      doc.addEventListener(
        "wheel",
        (event) => {
          let scroller: HTMLElement | null = element.parentElement;
          while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
          const target = scroller ?? document.scrollingElement;
          if (!target) return;
          event.preventDefault();
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
          target.scrollBy({ top: event.deltaY * unit, left: 0, behavior: "instant" });
        },
        { passive: false },
      );
    }
  }, [shownKey]);

  // A new width measures again: a phone turned, a window resized, the chat docked beside.
  useLayoutEffect(() => {
    const box = host.current;
    if (!box) return;
    let last = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === last) return;
      last = box.clientWidth;
      measure();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={host}
      className="mail-frame"
      data-mode={mode}
      data-adapts={shown?.adapts ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      data-loading={!ready ? "" : undefined}
      aria-busy={!ready}
    >
      {!shown ? (
        <div className="mail-frame-wait" role="status" aria-label="Reading the message">
          <span className="skeleton skeleton-title" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : (
        <div className="mail-paper" style={ready ? { height: `${fit.height * fit.scale}px` } : undefined}>
          <iframe
            key={shownKey}
            ref={frame}
            title="The message"
            className="mail-iframe"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={shown.doc}
            onLoad={measure}
            style={
              ready
                ? { width: `${fit.width}px`, height: `${fit.height}px`, transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }
                : undefined
            }
            data-scale={ready ? fit.scale.toFixed(3) : undefined}
          />
        </div>
      )}
    </div>
  );
}
