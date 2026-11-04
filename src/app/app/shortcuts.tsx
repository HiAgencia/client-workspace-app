"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { useExit } from "@/components/ui/use-exit";
import { useMac } from "./side-nav";

const OPEN_EVENT = "client-workspace:shortcuts";

export function showShortcuts() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Row = { does: string; keys: string[][] };

export function Shortcuts() {
  const mac = useMac();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setOpen(true);
    };
    const onAsk = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onAsk);
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const shown = useExit(open, dialog);

  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  const shift = mac ? "⇧" : "Shift";
  const groups: Array<{ name: string; rows: Row[] }> = [
    {
      name: "Anywhere",
      rows: [
        { does: "Add a task where you are", keys: [["Q"]] },
        { does: "Search and jump anywhere", keys: [[mod, "K"]] },
        { does: "Show these keys", keys: [["?"]] },
      ],
    },
    {
      name: "On a task in a list",
      rows: [
        { does: "Move it up or down", keys: [[alt, "↑"], [alt, "↓"]] },
        { does: "Move it to the group before or after", keys: [[alt, shift, "↑"], [alt, shift, "↓"]] },
      ],
    },
    { name: "In Mail", rows: [{ does: "Open the next or the previous message", keys: [["J"], ["K"]] }] },
    { name: "In a dialog, a menu or a list", rows: [{ does: "Close it", keys: [["Esc"]] }] },
  ];

  return (
    <dialog
      ref={dialog}
      className="dialog shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={() => setOpen(false)}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) setOpen(false);
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {shown && (
        <div className="shortcuts-in" data-cascade>
          <div className="shortcuts-head">
            <h2 id="shortcuts-title" className="t-title">
              Keyboard shortcuts
            </h2>
            <Button size="sm" variant="quiet" className="btn-icon" onClick={() => setOpen(false)} title="Close">
              <CloseIcon />
              <span className="sr-only">Close</span>
            </Button>
          </div>
          {groups.map((group) => (
            <section key={group.name} className="shortcuts-group" aria-labelledby={`shortcuts-${group.name}`}>
              <h3 id={`shortcuts-${group.name}`} className="shortcuts-name">
                {group.name}
              </h3>
              <dl className="shortcuts-list">
                {group.rows.map((row) => (
                  <div key={row.does} className="shortcuts-row">
                    <dt>{row.does}</dt>
                    <dd className="shortcuts-keys">
                      {row.keys.map((combo, index) => (
                        <Fragment key={combo.join("+")}>
                          {index > 0 && (
                            <span className="shortcuts-or" aria-label="or">
                              /
                            </span>
                          )}
                          <span className="shortcuts-combo">
                            {combo.map((key) => (
                              <kbd key={key} className="kbd">
                                {key}
                              </kbd>
                            ))}
                          </span>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}
