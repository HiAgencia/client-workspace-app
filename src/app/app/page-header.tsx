"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChatIcon, CloseIcon, FilterIcon } from "@/components/ui/icons";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { usePiece } from "@/components/ui/use-piece";
import { PRODUCT_NAME } from "@/lib/product";
import { useStrings } from "@/lib/strings";
import { cx } from "@/lib/utils";
import { useWorkspace } from "./workspace";

type Crumb = { label: string; href?: string };
export type PageLayout = "list" | "board";

type PageHeaderProps = {
  title: ReactNode;
  mark?: ReactNode;
  count?: ReactNode;
  trail?: Crumb[];
  filters?: ReactNode;
  filtersSet?: number;
  layout?: { value: PageLayout; onChange: (value: PageLayout) => void };
  views?: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void };
  chat?: boolean;
  more?: ReactNode;
  titleProps?: Record<`data-${string}`, string>;
  className?: string;
};

export function PageHeader({ title, mark, count, trail, filters, filtersSet = 0, layout, views, chat, more, titleProps, className }: PageHeaderProps) {
  const { t } = useStrings();
  const hasTools = Boolean(filters || layout || views || chat || more);
  const heading = useRef<HTMLHeadingElement>(null);
  const sheeted = useSyncExternalStore(subscribeSheeted, () => window.matchMedia(SHEETED_QUERY).matches, () => false);
  useEffect(() => {
    const el = heading.current;
    if (!el) return;
    const name = () => {
      if (!el.isConnected) return;
      const shown = el.textContent?.replace(/\s+/g, " ").trim();
      const wanted = shown ? `${shown} · ${PRODUCT_NAME}` : "";
      if (wanted && document.title !== wanted) document.title = wanted;
    };
    name();
    const watchHeading = new MutationObserver(name);
    watchHeading.observe(el, { childList: true, characterData: true, subtree: true });
    const watchTitle = new MutationObserver(name);
    watchTitle.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watchHeading.disconnect();
      watchTitle.disconnect();
    };
  }, []);
  return (
    <header className={cx("page-header", className)} data-page-header>
      <div className="page-header-text">
        {trail && trail.length > 0 && (
          <nav aria-label={t("common.whereThisPageLives")}>
            <ol className="page-trail">
              {trail.map((crumb, index) => (
                <li key={`${index}-${crumb.label}`}>
                  {crumb.href ? (
                    <Link href={crumb.href} className="page-trail-link">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="page-trail-label">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="page-title-line">
          {mark}
          <h1 ref={heading} className="t-h1 page-title" tabIndex={-1} data-page-title {...titleProps}>
            {title}
          </h1>
        </div>
        {count !== undefined && count !== null && count !== false && <p className="page-count">{count}</p>}
      </div>
      {hasTools && (
        <div className="page-tools" role="group" aria-label={t("common.thisPageControls")}>
          {filters && !sheeted && <div className="page-filters">{filters}</div>}
          {filters && <FilterSheet set={filtersSet} sheeted={sheeted}>{filters}</FilterSheet>}
          {layout && <ViewSwitch label={t("common.view")} value={layout.value} options={[{ value: "list", label: t("common.list") }, { value: "board", label: t("common.board") }]} onChange={(value) => layout.onChange(value as PageLayout)} />}
          {!layout && views && <ViewSwitch label={views.label} value={views.value} options={views.options} onChange={views.onChange} />}
          {chat && <ChatButton />}
          {more}
        </div>
      )}
    </header>
  );
}

const SHEETED_QUERY = "(width < 40rem)";

function subscribeSheeted(onChange: () => void) {
  const query = window.matchMedia(SHEETED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function FilterSheet({ set, sheeted, children }: { set: number; sheeted: boolean; children: ReactNode }) {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const shown = open && sheeted;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (shown && !el.open) el.showModal();
    if (!shown && el.open) el.close();
  }, [shown]);
  return (
    <>
      <Button
        className="page-filter-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-filter-open
        onClick={() => {
          setEverOpened(true);
          setOpen(true);
        }}
      >
        <FilterIcon />
        <span className="btn-label">{t("common.filter")}</span>
        {set > 0 && (
          <span className="pill page-filter-set" data-tone="accent">
            {set}
            <span className="sr-only">{t("header.filterSet")}</span>
          </span>
        )}
      </Button>
      <dialog
        ref={dialog}
        className="dialog filter-sheet"
        aria-labelledby={titleId}
        data-filter-sheet
        onClose={() => setOpen(false)}
        onPointerDown={(event) => {
          if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
        }}
        onClick={(event) => {
          if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) setOpen(false);
          if (dialog.current) delete dialog.current.dataset.downOutside;
        }}
      >
        <PopupLayerProvider container={dialog}>
          <div className="filter-sheet-in" data-cascade>
            <div className="filter-sheet-head">
              <h2 id={titleId} className="t-title">
                {t("common.filter")}
              </h2>
              <Button size="sm" variant="quiet" className="btn-icon" onClick={() => setOpen(false)} title={t("common.close")}>
                <CloseIcon />
                <span className="sr-only">{t("common.close")}</span>
              </Button>
            </div>
            {everOpened && sheeted && <div className="filter-sheet-fields">{children}</div>}
          </div>
        </PopupLayerProvider>
      </dialog>
    </>
  );
}

function ViewSwitch({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  usePiece(rail, '[aria-pressed="true"]');
  return (
    <div className="named page-layout-named">
      <div ref={rail} role="group" aria-label={label} className="seg page-layout" data-page-layout={value}>
        {options.map((option) => (
          <button key={option.value} type="button" className="seg-option" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatButton() {
  const { chat } = useWorkspace();
  const { t } = useStrings();
  return (
    <Button aria-expanded={chat.open} aria-controls={chat.open ? "chat-panel" : undefined} data-chat-toggle onClick={() => chat.setOpen(!chat.open)}>
      <ChatIcon />
      <span className="btn-label">{t("common.chat")}</span>
    </Button>
  );
}
