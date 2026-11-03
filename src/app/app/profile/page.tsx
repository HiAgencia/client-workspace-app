"use client";

import { useEffect, useRef, useState, ViewTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { GoogleMark } from "@/components/ui/brands";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SignOutIcon } from "@/components/ui/icons";
import { NAME_MAX, nameToStore } from "@/lib/session-person";
import { browserClient } from "@/lib/supabase/browser";
import { BoxWait } from "../boxes";
import { PageHeader } from "../page-header";
import { useWorkspace, type Person } from "../workspace";
import "../../styles/settings.css";


const SAVE_AFTER_MS = 700;



export default function ProfilePage() {
  const { person } = useWorkspace();
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-settings page-profile">
        <PageHeader title="Profile" />
        {person === null ? (
          <section className="box settings-box" aria-label="Your profile" data-shown="">
            <div className="box-body">
              <BoxWait what="Reading your profile…" rows={2} />
            </div>
          </section>
        ) : person.isAnonymous ? (
          <DemoProfile />
        ) : (
          <ProfileBox person={person} />
        )}
      </div>
    </ViewTransition>
  );
}

function ProfileBox({ person }: { person: Person }) {
  const { config, saving, signOut } = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const shown = draft ?? person.name ?? "";
  
  const kept = person.name !== person.googleName ? person.name : null;

  useEffect(() => () => clearTimeout(timer.current), []);

  async function save(typed: string) {
    clearTimeout(timer.current);
    const next = nameToStore(typed, person.googleName);
    if (next === kept) return;
    const write = browserClient(config)
      .auth.updateUser({ data: { display_name: next } })
      .then(({ error }) => (error ? { ok: false, message: `The name could not be saved: ${error.message}` } : { ok: true }));
    await saving(write, { reread: false });
  }

  return (
    <section className="box settings-box profile-box" aria-labelledby="profile-title" data-shown="" data-profile>
      <header className="box-head profile-head">
        <Avatar className="profile-avatar" src={person.avatarUrl} name={person.name} email={person.email} />
        <div className="profile-who">
          <h2 id="profile-title" className="t-title box-title" tabIndex={-1}>
            {person.name ?? person.email}
          </h2>
          {person.email && <p className="t-meta profile-email">{person.email}</p>}
        </div>
      </header>
      <div className="box-body">
        <div className="profile-field">
          <label htmlFor="profile-name" className="t-label">
            Name
          </label>
          <Field
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={NAME_MAX}
            placeholder={person.googleName ?? "Your name"}
            aria-describedby="profile-name-help"
            value={shown}
            onFocus={() => setDraft(person.name ?? "")}
            onChange={(event) => {
              const typed = event.target.value;
              setDraft(typed);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void save(typed), SAVE_AFTER_MS);
            }}
            onBlur={() => {
              if (draft !== null) void save(draft);
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save(shown);
              }
              
              if (event.key === "Escape") {
                event.preventDefault();
                clearTimeout(timer.current);
                setDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <p id="profile-name-help" className="t-help">
            {person.googleName ? "How the workspace names you. Leave it empty to use the name on your Google account." : "How the workspace names you."}
          </p>
        </div>
        <div className="settings-line profile-session">
          <p className="t-help profile-signed">
            <GoogleMark />
            <span>Signed in with Google.</span>
          </p>
          <Button onClick={signOut} data-sign-out>
            <SignOutIcon />
            <span className="btn-label">Sign out</span>
          </Button>
        </div>
      </div>
    </section>
  );
}


function DemoProfile() {
  const { signOut } = useWorkspace();
  return (
    <section className="box settings-box profile-box" aria-labelledby="profile-title" data-shown="" data-profile="demo">
      <header className="box-head profile-head">
        <Avatar className="profile-avatar" src={null} name="Demo session" email={null} />
        <div className="profile-who">
          <h2 id="profile-title" className="t-title box-title" tabIndex={-1}>
            Demo session
          </h2>
          <p className="t-meta profile-email">A workspace of sample clients and projects</p>
        </div>
      </header>
      <div className="box-body">
        <div className="settings-line profile-session">
          <p className="t-help">The demo has no profile. Sign in with Google to keep a workspace of your own.</p>
          <Button onClick={signOut} data-sign-out>
            <SignOutIcon />
            <span className="btn-label">Sign out</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
