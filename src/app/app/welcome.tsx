"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { AddIcon, ClientIcon, OwnProjectIcon, type Icon } from "@/components/ui/icons";
import { focusAfterClose } from "@/components/ui/use-exit";
import { firstName } from "@/lib/session-person";
import { useStrings } from "@/lib/strings";
import { post } from "./client-api";
import { requestFocus } from "./focus-request";
import { useWorkspace, type Person } from "./workspace";

export function Welcome({ person }: { person: Person }) {
  const { t } = useStrings();
  const first = firstName(person.name);
  return (
    <section className="welcome" aria-labelledby="welcome-title" data-welcome>
      <div className="welcome-head" data-cascade style={{ "--cascade-from": "calc(var(--enter-step) * 2)" } as CSSProperties}>
        <Avatar className="welcome-avatar" src={person.avatarUrl} name={person.name} email={person.email} />
        <h2 id="welcome-title" className="t-h1 welcome-title">
          {first ? t("welcome.helloName", { name: first }) : t("welcome.hello")}
        </h2>
        <p className="welcome-lead">{t("welcome.lead")}</p>
      </div>
      <div className="welcome-paths">
        <WelcomePath
          kind="project"
          order={0}
          icon={OwnProjectIcon}
          title={t("welcome.ownTitle")}
          text={person.email ? t("welcome.ownTextEmail", { email: person.email }) : t("welcome.ownText")}
          add={t("welcome.addOwn")}
          field={t("welcome.ownField")}
          submit={t("welcome.addProject")}
        />
        <WelcomePath
          kind="client"
          order={1}
          icon={ClientIcon}
          title={t("welcome.clientTitle")}
          text={t("welcome.clientText")}
          add={t("welcome.addClient")}
          field={t("welcome.clientField")}
          submit={t("welcome.addClientSubmit")}
        />
      </div>
    </section>
  );
}

type PathProps = { kind: "project" | "client"; order: number; icon: Icon; title: string; text: string; add: string; field: string; submit: string };

function WelcomePath({ kind, order, icon: Glyph, title, text, add, field, submit }: PathProps) {
  const { t } = useStrings();
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
    focusAfterClose(() => opener.current);
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
              {t("common.cancel")}
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
