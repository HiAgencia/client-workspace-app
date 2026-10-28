"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { get, post } from "./client-api";
import { useWorkspace } from "./workspace";

type SavedView = { id: string; name: string; query: string };

// "Save view": the panel's filters under a name, listed in the sidebar for the next time.
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

// The saved views in the sidebar: each opens the panel with its filters; the current one is marked.
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

  if (!views || views.length === 0) return null;
  const current = pathname === "/app" ? params.toString() : null;
  return (
    <section className="side-group" aria-labelledby="views-title" data-saved-views>
      <div className="side-head">
        <h2 id="views-title" className="t-label">
          Views
        </h2>
      </div>
      {views.map((view) => (
        <Link key={view.id} href={`/app${view.query ? `?${view.query}` : ""}`} className="side-link" aria-current={current === view.query ? "page" : undefined} data-saved-view={view.name}>
          <span className="side-link-name">{view.name}</span>
        </Link>
      ))}
    </section>
  );
}
