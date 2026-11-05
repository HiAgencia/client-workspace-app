"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useMedia } from "@/components/ui/use-media";
import { DarkIcon, DownIcon, ImageIcon, LightIcon, UpIcon } from "@/components/ui/icons";
import { usePiece } from "@/components/ui/use-piece";
import { currentLanguage } from "@/lib/language";
import { translateNow, useStrings } from "@/lib/strings";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import type { MailRow } from "@/lib/tools/mail-schema";
import { tool } from "../client-api";
import { SenderMark } from "../item-parts";
import { documentFor } from "./mail-document";
import { subjectOf } from "./subject";
import { PlaceName } from "../task-row";
import { useSwap } from "../use-swap";

export type MailContent = MailRow & { html: string; text: string | null; remoteImages: number; language: string | null };

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

export function useMailMode(): { mode: Theme; setMode: (next: Theme) => void } {
  const productTheme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as Theme);
  const chosen = useSyncExternalStore(subscribeStore, storedMode, () => null);
  return { mode: chosen ?? productTheme, setMode: (next) => remember(MODE_KEY, next) };
}

export const MAIL_PHONE = "(width < 40rem)";

const fullTime = (iso: string) =>
  new Intl.DateTimeFormat(currentLanguage(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type ViewerProps = {
  row: MailRow;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  note?: ReactNode;
  actions: ReactNode;
  below: ReactNode;
  more: ReactNode;
  onClose?: () => void;
};

export function MailViewer({ row, onPrevious, onNext, note, actions, below, more, onClose }: ViewerProps) {
  const { t, counted } = useStrings();
  const key = `${row.accountId}:${row.id}`;
  const [read, setRead] = useState<{ key: string; message: MailContent | null; error: string | null } | null>(null);
  const { mode, setMode } = useMailMode();
  const phone = useMedia(MAIL_PHONE);
  const senders = useSyncExternalStore(subscribeStore, () => localStorage.getItem(IMAGES_KEY) ?? "[]", () => "[]");
  const sender = row.from.email.toLowerCase();
  const imagesOn = imageSenders().includes(sender);
  void senders;

  useEffect(() => {
    let live = true;
    void tool<{ message: MailContent }>("get_mail", { account: row.accountId, id: row.id, whole: true }).then((answer) => {
      if (!live) return;
      setRead({ key, message: answer.ok ? answer.message : null, error: answer.ok ? null : answer.message });
    });
    return () => {
      live = false;
    };
  }, [key, row.accountId, row.id]);

  const message = read?.key === key ? read.message : null;
  const setImages = (on: boolean) => {
    const list = imageSenders().filter((entry) => entry !== sender);
    remember(IMAGES_KEY, JSON.stringify(on ? [...list, sender] : list));
  };

  const moving = (
    <div className="mail-bar-move">
      <div className="btn-group" role="group" aria-label={t("viewer.moveThrough")}>
        {onClose && (
          <Button size="sm" onClick={onClose} aria-label={t("viewer.backToList")}>
            {t("viewer.back")}
          </Button>
        )}
        <Button
          size="sm"
          className="btn-icon"
          title={t("viewer.prevTitle")}
          aria-keyshortcuts="K"
          onClick={onPrevious ?? undefined}
          disabled={!onPrevious}
          aria-label={onPrevious ? t("viewer.prev") : t("viewer.prevNone")}
        >
          <UpIcon />
        </Button>
        <Button size="sm" className="btn-icon" title={t("viewer.nextTitle")} aria-keyshortcuts="J" onClick={onNext ?? undefined} disabled={!onNext} aria-label={onNext ? t("viewer.next") : t("viewer.nextNone")}>
          <DownIcon />
        </Button>
      </div>
      {phone ? more : <ModeSwitch value={mode} onChange={setMode} />}
    </div>
  );
  const acting = <div className="mail-actions">{actions}</div>;

  return (
    <article className="mail-viewer" aria-labelledby="mail-subject" data-mail-viewer={key}>
      <div className="mail-bar">
        {moving}
        {acting}
      </div>
      <header key={key} className="mail-head">
        <h2 id="mail-subject" className="t-title mail-head-subject" tabIndex={-1}>
          {subjectOf(row)}
        </h2>
        <div className="mail-from-line">
          <SenderMark name={row.from.name ?? row.from.email} email={row.from.email} />
          <span className="mail-from-who">
            <span className="t-name">{row.from.name ?? row.from.email}</span>
            {row.from.name && <span className="t-meta mail-address">{row.from.email}</span>}
          </span>
          <span className="t-meta mail-head-when">{fullTime(row.receivedAt)}</span>
        </div>
        <div className="t-meta mail-where-line">
          <span>
            {t("viewer.to")} <span className="mail-address">{row.accountEmail}</span>
            {note}
          </span>
          <span className="mail-where-place">
            {row.place ? (
              <>
                {t("viewer.in")} <PlaceName path={row.place.path} color={row.place.color} />
              </>
            ) : (
              t("viewer.notLinked")
            )}
          </span>
          {row.important && (
            <span className="pill" data-tone="warn">
              {t("mailPage.important")}
            </span>
          )}
        </div>
      </header>

      {below}

      {message && message.remoteImages > 0 && (
        <div className="mail-images" data-mail-images={imagesOn ? "shown" : "held"}>
          <ImageIcon className="mail-images-icon" />
          <p className="t-meta">
            {imagesOn
              ? t("viewer.imagesAuto", { email: row.from.email })
              : t(message.remoteImages === 1 ? "viewer.imageHidden" : "viewer.imagesHidden", { what: counted(message.remoteImages, "counted.image", "counted.images") })}
          </p>
          <Button size="sm" variant="quiet" onClick={() => setImages(!imagesOn)} data-show-images={imagesOn ? undefined : ""}>
            {imagesOn ? t("viewer.stopImages") : t("viewer.showImages")}
          </Button>
        </div>
      )}

      {read?.key === key && read.error ? (
        <p role="alert" className="inline-note" data-tone="alert">
          {t("viewer.notLoaded", { message: read.error })}
        </p>
      ) : (
        <MailFrame message={message} messageKey={key} mode={mode} images={imagesOn} />
      )}
    </article>
  );
}

function ModeSwitch({ value, onChange }: { value: Theme; onChange: (value: Theme) => void }) {
  const { t } = useStrings();
  const rail = useRef<HTMLDivElement>(null);
  usePiece(rail, '[aria-pressed="true"]');
  return (
    <div ref={rail} role="group" aria-label={t("mailPage.mailColors")} className="seg mail-mode" data-mail-mode={value}>
      {(["light", "dark"] as const).map((option) => (
        <button key={option} type="button" className="seg-option" aria-pressed={option === value} title={option === "light" ? t("mailPage.light") : t("mailPage.dark")} onClick={() => onChange(option)}>
          {option === "light" ? <LightIcon /> : <DarkIcon />}
          <span className="sr-only">{option === "light" ? t("mailPage.light") : t("mailPage.dark")}</span>
        </button>
      ))}
    </div>
  );
}

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
    const style = getComputedStyle(box);
    const available = Math.floor(box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    if (available <= 0) return;
    element.style.width = `${available}px`;
    const natural = Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0);
    const width = Math.max(available, natural);
    element.style.width = `${width}px`;
    const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    setFit({ key: shownKey, width, height, scale: Math.min(1, available / width) });
    if (!doc.documentElement.dataset.wheel) {
      doc.documentElement.dataset.wheel = "";
      doc.addEventListener(
        "wheel",
        (event) => {
          const down = event.deltaY > 0;
          const moves = (box: HTMLElement) => box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY) && (down ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 0);
          let scroller: HTMLElement | null = element.parentElement;
          while (scroller && !moves(scroller)) scroller = scroller.parentElement;
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
      data-leaving={leaving ? "" : undefined}
      data-loading={!ready ? "" : undefined}
      aria-busy={!ready}
    >
      {!shown ? (
        <div className="mail-frame-wait" role="status" aria-label={translateNow("viewer.loadingMessage")}>
          <span className="skeleton skeleton-title" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : (
        <div className="mail-paper" style={ready ? { height: `${fit.height * fit.scale}px` } : undefined}>
          <iframe
            key={shownKey}
            ref={frame}
            title={translateNow("viewer.theMessage")}
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
