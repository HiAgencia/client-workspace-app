"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePiece } from "@/components/ui/use-piece";
import { PRODUCT_NAME } from "@/lib/product";
import { cx } from "@/lib/utils";
import { useWorkspace } from "./workspace";

export type Crumb = { label: string; href?: string };
export type PageLayout = "list" | "board";

type PageHeaderProps = {
  // The page's name, its main title.
  title: ReactNode;
  // What it holds, in one line under the title: «5 overdue or due today», «6 open tasks».
  count?: ReactNode;
  // Where it lives, only on a client's or a project's page: «Clients / Larkspur Bakery».
  trail?: Crumb[];
  // The controls the page has, always in this order and with one skin: its filters, «List | Board», «Chat» and «More».
  filters?: ReactNode;
  layout?: { value: PageLayout; onChange: (value: PageLayout) => void };
  // Another pair of exclusive views in the place «List | Board» takes, such as «Week | Month»; a page has one or the other.
  views?: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void };
  // Whether the page offers the chat; the conversation is the one the page set with `useChatScope`.
  chat?: boolean;
  // The page's «More» menu, the trigger included.
  more?: ReactNode;
  // What the checks find the title by, such as `{ "data-node-title": "" }`.
  titleProps?: Record<`data-${string}`, string>;
  className?: string;
};

// The one form of every page's header: on the left where the page lives, its title and its count; on the right its
// controls. Each page hands in what it has, and nothing else enters the bar.
export function PageHeader({ title, count, trail, filters, layout, views, chat, more, titleProps, className }: PageHeaderProps) {
  const hasTools = Boolean(filters || layout || views || chat || more);
  const heading = useRef<HTMLHeadingElement>(null);
  // The document's title names the screen the person is on —the tab, the history, a bookmark— and it follows the
  // heading: a node's name arrives with its data, so the heading itself is watched instead of the props.
  useEffect(() => {
    const el = heading.current;
    if (!el) return;
    const name = () => {
      const shown = el.textContent?.replace(/\s+/g, " ").trim();
      const wanted = shown ? `${shown} · ${PRODUCT_NAME}` : "";
      if (wanted && document.title !== wanted) document.title = wanted;
    };
    name();
    const watchHeading = new MutationObserver(name);
    watchHeading.observe(el, { childList: true, characterData: true, subtree: true });
    // The app writes the title it declares when a page finishes resolving —a message's viewer arrives late and puts the
    // product's name back—: the screen's heading restores its own, and only when the title is not already that.
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
          <nav aria-label="Where this page lives">
            <ol className="page-trail">
              {trail.map((crumb, index) => (
                <li key={`${index}-${crumb.label}`}>
                  {crumb.href ? (
                    <Link href={crumb.href} className="page-trail-link">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="page-trail-here">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 ref={heading} className="t-h1 page-title" tabIndex={-1} data-page-title {...titleProps}>
          {title}
        </h1>
        {count !== undefined && count !== null && count !== false && <p className="page-count">{count}</p>}
      </div>
      {hasTools && (
        <div className="page-tools" role="group" aria-label="This page's controls">
          {filters && <div className="page-filters">{filters}</div>}
          {layout && <ViewSwitch label="Layout" value={layout.value} options={LAYOUTS} onChange={(value) => layout.onChange(value as PageLayout)} />}
          {!layout && views && <ViewSwitch label={views.label} value={views.value} options={views.options} onChange={views.onChange} />}
          {chat && <ChatButton />}
          {more}
        </div>
      )}
    </header>
  );
}

const LAYOUTS: Array<{ value: PageLayout; label: string }> = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
];

// «List | Board» (or «Week | Month»): exclusive views of the same content, a sunken rail and one raised piece that travels
// to the chosen one. Each is a pressed button: the view changes in place, so it is not a tab with its own panel.
function ViewSwitch({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  usePiece(rail, '[aria-pressed="true"]');
  return (
    <div ref={rail} role="group" aria-label={label} className="seg page-layout" data-page-layout={value}>
      {options.map((option) => (
        <button key={option.value} type="button" className="seg-option" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// «Chat» opens the panel beside the page, on the page's own conversation, and closes it again.
function ChatButton() {
  const { chat } = useWorkspace();
  return (
    <Button size="sm" aria-expanded={chat.open} data-chat-toggle onClick={() => chat.setOpen(!chat.open)}>
      Chat
    </Button>
  );
}
