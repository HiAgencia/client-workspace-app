"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePiece } from "@/components/ui/use-piece";
import { PRODUCT_NAME } from "@/lib/product";
import { cx } from "@/lib/utils";
import { useWorkspace } from "./workspace";

export type Crumb = { label: string; href?: string };
export type PageLayout = "list" | "board";

type PageHeaderProps = {
  
  title: ReactNode;
  
  count?: ReactNode;
  
  trail?: Crumb[];
  
  filters?: ReactNode;
  layout?: { value: PageLayout; onChange: (value: PageLayout) => void };
  
  views?: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void };
  
  chat?: boolean;
  
  more?: ReactNode;
  
  titleProps?: Record<`data-${string}`, string>;
  className?: string;
};



export function PageHeader({ title, count, trail, filters, layout, views, chat, more, titleProps, className }: PageHeaderProps) {
  const hasTools = Boolean(filters || layout || views || chat || more);
  const heading = useRef<HTMLHeadingElement>(null);
  
  
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


function ChatButton() {
  const { chat } = useWorkspace();
  return (
    <Button size="sm" aria-expanded={chat.open} data-chat-toggle onClick={() => chat.setOpen(!chat.open)}>
      Chat
    </Button>
  );
}
