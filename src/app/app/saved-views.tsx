"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { boardQuery } from "@/lib/board-params";
import { get, post } from "./client-api";
import { useWorkspace } from "./workspace";

type SavedView = { id: string; name: string; query: string };

// The Overview's saved views, in its general bar: open one, or save the board's filters under a name for the next time.
export function SavedViews({ query }: { query: string }) {
  const { saving, version } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    void get<{ views: SavedView[] }>("/api/views").then((answer) => {
      if (answer.ok) {
        setViews(answer.views);
        setFailed(null);
      } else setFailed(answer.message);
    });
  }, [version]);

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

  // The view on screen is the one whose filters are the board's now, whatever else the address carries.
  const shown = boardQuery(query);
  const current = (views ?? []).find((view) => boardQuery(view.query) === shown);
  return (
    <div className="saved-views" data-saved-views>
      {failed && (
        <p role="alert" className="inline-note" data-tone="alert">
          The saved views could not be read: {failed}.
        </p>
      )}
      {views && views.length > 0 && (
        <Select
          label="Saved view"
          placeholder="Open a saved view…"
          value={current?.id ?? null}
          options={views.map((view) => ({ value: view.id, label: view.name }))}
          onChange={(id) => {
            const view = views.find((entry) => entry.id === id);
            if (view) router.replace(`${pathname}${view.query ? `?${view.query}` : ""}`, { scroll: false });
          }}
        />
      )}
      {naming ? (
        <div className="inline">
          <Field autoFocus id="view-name" name="view-name" aria-label="View name" placeholder="Name this view, such as Urgent this week" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
          <Button size="sm" variant="primary" onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => setNaming(true)} data-save-view>
          Save this view
        </Button>
      )}
    </div>
  );
}
