"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { get, post } from "./client-api";
import { PANEL_LAST_KEY } from "./panel-state";
import { useWorkspace } from "./workspace";

type SavedView = { id: string; name: string; query: string };


export function SaveView({ query }: { query: string }) {
  const { saving } = useWorkspace();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  async function save() {
    if (!name.trim()) return;
    if (await saving(post("/api/views", { action: "save", name, query }))) {
      setNaming(false);
      setName("");
    }
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void save();
    if (event.key === "Escape") {
      event.preventDefault();
      setNaming(false);
    }
  };

  if (!naming) {
    return (
      <div>
        <Button size="sm" onClick={() => setNaming(true)} data-save-view>
          Save view
        </Button>
      </div>
    );
  }
  return (
    <div className="quick-add">
      <Field autoFocus id="view-name" name="view-name" aria-label="View name" placeholder="Name this view, such as Urgent this week" className="grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
      <Button size="sm" variant="primary" onClick={() => void save()}>
        Save
      </Button>
      <Button size="sm" onClick={() => setNaming(false)}>
        Cancel
      </Button>
    </div>
  );
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const readLast = () => localStorage.getItem(PANEL_LAST_KEY);


export function SavedViewsNav() {
  const { version } = useWorkspace();
  const pathname = usePathname();
  const params = useSearchParams();
  const [views, setViews] = useState<SavedView[] | null>(null);

  useEffect(() => {
    void get<{ views: SavedView[] }>("/api/views").then((answer) => {
      if (answer.ok) setViews(answer.views);
    });
  }, [version]);

  const current = pathname === "/app" ? params.toString() : null;
  
  
  const last = useSyncExternalStore(subscribeStorage, readLast, () => null);
  const offerLast = Boolean(last) && last !== current && !(views ?? []).some((view) => view.query === last);
  if ((!views || views.length === 0) && !offerLast) return null;
  return (
    <section className="side-group" aria-labelledby="views-title" data-saved-views>
      <div className="side-head">
        <h2 id="views-title" className="t-label">
          Views
        </h2>
      </div>
      {offerLast && (
        <Link href={`/app?${last}`} className="side-link" data-last-view>
          <span className="side-link-name">Last view</span>
        </Link>
      )}
      {(views ?? []).map((view) => (
        <Link key={view.id} href={`/app${view.query ? `?${view.query}` : ""}`} className="side-link" aria-current={current === view.query ? "page" : undefined} data-saved-view={view.name}>
          <span className="side-link-name">{view.name}</span>
        </Link>
      ))}
    </section>
  );
}
