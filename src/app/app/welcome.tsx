"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { AddIcon, ClientIcon, OwnProjectIcon, type Icon } from "@/components/ui/icons";
import { firstName } from "@/lib/session-person";
import { post } from "./client-api";
import { requestFocus } from "./focus-request";
import { useWorkspace, type Person } from "./workspace";





export function Welcome({ person }: { person: Person }) {
  const first = firstName(person.name);
  return (
    <section className="welcome" aria-labelledby="welcome-title" data-welcome>
      {}
      <div className="welcome-head" data-cascade style={{ "--cascade-from": "calc(var(--enter-step) * 2)" } as CSSProperties}>
        <Avatar className="welcome-avatar" src={person.avatarUrl} name={person.name} email={person.email} />
        <h2 id="welcome-title" className="t-h1 welcome-title">
          {first ? `Welcome, ${first}` : "Welcome"}
        </h2>
        <p className="welcome-lead">Start with your own work or with a client. Each one keeps its tasks, notes, calendar and mail together.</p>
      </div>
      <div className="welcome-paths">
        <WelcomePath
          kind="project"
          order={0}
          icon={OwnProjectIcon}
          title="Your own project"
          text={person.email ? `Your business or your own work. The calendar and mail of ${person.email} come into it.` : "Your business or your own work."}
          add="Add your own project"
          field="The name of your business or your work"
          submit="Add project"
        />
        <WelcomePath
          kind="client"
          order={1}
          icon={ClientIcon}
          title="A client"
          text="Someone you work for. Their projects, and the Google account you share with them, live in it."
          add="Add a client"
          field="The client's name"
          submit="Add client"
        />
      </div>
    </section>
  );
}

type PathProps = { kind: "project" | "client"; order: number; icon: Icon; title: string; text: string; add: string; field: string; submit: string };



function WelcomePath({ kind, order, icon: Glyph, title, text, add, field, submit }: PathProps) {
  const { saving } = useWorkspace();
  const router = useRouter();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const primary = kind === "project";

  function close() {
    setAdding(false);
    setName("");
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const answer = await post<{ node: { id: string } }>("/api/nodes", { name, kind });
    if ((await saving(Promise.resolve(answer))) && answer.ok) {
      requestFocus({ kind: "node", nodeId: answer.node.id });
      router.push(`/app/node/${answer.node.id}`);
      return;
    }
    setBusy(false);
  }

  return (
    
    <section className="welcome-path" aria-labelledby={`${id}title`} data-welcome-path={kind} data-open={adding || undefined} style={{ "--enter-delay": `calc(var(--enter-step) * ${6 + order})` } as CSSProperties}>
      <span className="welcome-icon" aria-hidden="true">
        <Glyph />
      </span>
      <h3 id={`${id}title`} className="t-title welcome-path-title">
        {title}
      </h3>
      <p className="t-help welcome-path-text">{text}</p>
      <Fold open={!adding} id={`${id}open`}>
        <div className="welcome-open">
          <Button ref={opener} variant={primary ? "primary" : undefined} aria-expanded={adding} aria-controls={`${id}form`} onClick={() => setAdding(true)} data-welcome-add={kind}>
            <AddIcon />
            <span className="btn-label">{add}</span>
          </Button>
        </div>
      </Fold>
      <Fold open={adding} id={`${id}form`} lazy>
        <form className="welcome-form" onSubmit={(event) => void create(event)}>
          <Field
            autoFocus
            name={`${kind}-name`}
            aria-label={field}
            placeholder={field}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              close();
            }}
          />
          <div className="welcome-form-actions">
            <Button size="sm" variant="quiet" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || busy} aria-busy={busy || undefined}>
              {submit}
            </Button>
          </div>
        </form>
      </Fold>
    </section>
  );
}
