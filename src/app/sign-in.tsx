"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { Button, buttonClass } from "@/components/ui/button";
import type { PublicConfig } from "@/lib/env";
import { dayOf } from "@/lib/dates";
import { browserClient } from "@/lib/supabase/browser";
import { signInWithGoogle } from "@/lib/supabase/google-sign-in";
import type { SessionUser } from "@/lib/supabase/server";
import { askOnceMoreIfCut, forgetLayout } from "./app/client-api";

type Session = { kind: "loading" } | { kind: "out" } | { kind: "in"; user: SessionUser };


type Spot = "nav" | "hero" | "end";
type Way = { session: Session; busy: { what: "google" | "demo" | "out"; at: Spot } | null; error: { text: string; at: Spot } | null };

const START: Way = { session: { kind: "loading" }, busy: null, error: null };
const NO_ANSWER = "The server did not answer. Reload the page.";



let way: Way = START;
let round = 0;
let readers = 0;
const listeners = new Set<() => void>();

function put(next: Partial<Way>, of: number) {
  if (of !== round) return;
  way = { ...way, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}



async function readSession(config: PublicConfig, of: number) {
  try {
    const { data } = await browserClient(config).auth.getSession();
    if (!data.session) return put({ session: { kind: "out" } }, of);
    const response = await askOnceMoreIfCut("/api/me", {});
    if (response instanceof Response && response.status === 401) return put({ session: { kind: "out" } }, of);
    if (!(response instanceof Response) || !response.ok) return put({ error: { text: NO_ANSWER, at: "hero" } }, of);
    const body = (await response.json()) as { user: SessionUser };
    put({ session: { kind: "in", user: body.user } }, of);
  } catch {
    put({ error: { text: NO_ANSWER, at: "hero" } }, of);
  }
}

function useWay(config: PublicConfig): Way {
  const current = useSyncExternalStore(subscribe, () => way, () => START);
  useEffect(() => {
    readers += 1;
    if (readers === 1) {
      round += 1;
      way = START;
      void readSession(config, round);
    }
    return () => {
      readers -= 1;
      if (readers > 0) return;
      round += 1;
      way = START;
    };
  }, [config]);
  return current;
}

async function withGoogle(config: PublicConfig, at: Spot) {
  const of = round;
  put({ busy: { what: "google", at }, error: null }, of);
  const { error } = await signInWithGoogle(config);
  if (error) put({ busy: null, error: { text: `Google sign-in is not available: ${error.message}`, at } }, of);
}

async function tryDemo(config: PublicConfig, at: Spot, enter: () => void) {
  const of = round;
  const fail = (text: string) => put({ busy: null, error: { text, at } }, of);
  put({ busy: { what: "demo", at }, error: null }, of);
  
  
  const { data: existing } = await browserClient(config).auth.getSession();
  if (!existing.session?.user.is_anonymous) {
    const { error } = await browserClient(config).auth.signInAnonymously();
    if (error) return fail(`The demo could not start: ${error.message}`);
  }
  
  
  const seeded = await askOnceMoreIfCut("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ today: dayOf(new Date()), zone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  if (!(seeded instanceof Response) || !seeded.ok) return fail("The demo workspace could not be prepared. Reload to try again.");
  
  
  enter();
}

async function signOut(config: PublicConfig) {
  const of = round;
  put({ busy: { what: "out", at: "hero" } }, of);
  await forgetLayout();
  await browserClient(config).auth.signOut();
  put({ busy: null, session: { kind: "out" } }, of);
}


function progress(busy: Way["busy"]): string | null {
  return busy?.what === "demo" ? "Preparing a demo workspace of your own…" : busy?.what === "google" ? "Opening Google…" : null;
}



export function SignInPlaceholder() {
  return (
    <div className="stack" role="status" aria-busy="true" aria-label="Checking your session">
      <span className="inline">
        <span className="skeleton session-skeleton" data-for="demo" />
        <span className="skeleton session-skeleton" data-for="google" />
      </span>
    </div>
  );
}



export function SignIn({ config, failed, go }: { config: PublicConfig; failed: boolean; go?: ReactNode }) {
  const { session, busy, error } = useWay(config);
  const router = useRouter();

  
  useEffect(() => {
    if (failed) put({ error: { text: "Signing in did not finish. Try again.", at: "hero" } }, round);
  }, [failed]);

  
  const said = busy && busy.at !== "end" ? progress(busy) : null;
  return (
    <section className="stack" aria-live="polite">
      {session.kind === "loading" && <SignInPlaceholder />}
      {session.kind === "out" && (
        <div className="inline fade-enter">
          <Button
            variant="primary"
            className="session-go"
            onClick={() => void tryDemo(config, "hero", () => router.push("/app/resume"))}
            disabled={busy !== null}
            aria-busy={busy?.what === "demo" && busy.at === "hero"}
          >
            <span className="btn-label">Try the demo</span>
            {go}
          </Button>
          <Button onClick={() => void withGoogle(config, "hero")} disabled={busy !== null} aria-busy={busy?.what === "google" && busy.at === "hero"}>
            <GoogleMark className="google-mark" />
            <span className="btn-label">Sign in with Google</span>
          </Button>
        </div>
      )}
      {session.kind === "out" && (
        <p className="t-meta" role="status">
          {said ?? "The demo is a workspace of your own with sample clients and projects; nothing is shared."}
        </p>
      )}
      {session.kind === "in" && (
        <div className="stack fade-enter" data-session={session.user.isAnonymous ? "anonymous" : "google"}>
          <div className="inline">
            <a className={buttonClass({ variant: "primary", className: "session-go" })} href="/app/resume">
              <span className="btn-label">Open the workspace</span>
              {go}
            </a>
            <Button onClick={() => void signOut(config)} disabled={busy !== null}>
              Sign out
            </Button>
          </div>
          <p className="t-meta">
            Signed in {session.user.isAnonymous ? "to the demo" : <>as <span className="t-name">{session.user.email}</span></>}.
          </p>
        </div>
      )}
      {error?.at === "hero" && (
        <p role="alert" className="inline-note" data-tone="alert">
          {error.text}
        </p>
      )}
    </section>
  );
}



export function NavSignInPlaceholder() {
  return (
    <span className="landing-nav-session" aria-hidden="true">
      <span className={buttonClass({ variant: "quiet", className: "landing-nav-sign-in" })}>
        <span className="btn-label">Sign in</span>
      </span>
      <span className={buttonClass({ variant: "primary" })}>
        <span className="btn-label">Try the demo</span>
      </span>
    </span>
  );
}



export function NavSignIn({ config }: { config: PublicConfig }) {
  const { session, busy, error } = useWay(config);
  const router = useRouter();
  
  
  if (session.kind === "loading") return <NavSignInPlaceholder />;
  if (session.kind === "in") {
    return (
      <a className={buttonClass({ variant: "primary", className: "landing-nav-open fade-enter" })} href="/app/resume">
        <span className="btn-label">Open the workspace</span>
      </a>
    );
  }
  return (
    <span className="landing-nav-session fade-enter" data-ready="">
      <Button
        variant="quiet"
        className="landing-nav-sign-in"
        onClick={() => void withGoogle(config, "nav")}
        disabled={busy !== null}
        aria-busy={busy?.what === "google" && busy.at === "nav"}
      >
        Sign in
      </Button>
      <Button
        variant="primary"
        onClick={() => void tryDemo(config, "nav", () => router.push("/app/resume"))}
        disabled={busy !== null}
        aria-busy={busy?.what === "demo" && busy.at === "nav"}
      >
        Try the demo
      </Button>
      {error?.at === "nav" && (
        <span role="alert" className="inline-note landing-nav-alert" data-tone="alert">
          {error.text}
        </span>
      )}
    </span>
  );
}



export function EndSignInPlaceholder() {
  return (
    <span className="inline" aria-hidden="true">
      <span className="skeleton session-skeleton" data-for="demo" />
      <span className="skeleton session-skeleton" data-for="google" />
    </span>
  );
}


export function EndSignIn({ config, go }: { config: PublicConfig; go?: ReactNode }) {
  const { session, busy, error } = useWay(config);
  const router = useRouter();
  return (
    <div className="stack">
      {session.kind === "loading" && <EndSignInPlaceholder />}
      {session.kind === "out" && (
        <div className="inline fade-enter">
          <Button
            variant="primary"
            className="session-go"
            onClick={() => void tryDemo(config, "end", () => router.push("/app/resume"))}
            disabled={busy !== null}
            aria-busy={busy?.what === "demo" && busy.at === "end"}
          >
            <span className="btn-label">Try the demo</span>
            {go}
          </Button>
          <Button onClick={() => void withGoogle(config, "end")} disabled={busy !== null} aria-busy={busy?.what === "google" && busy.at === "end"}>
            <GoogleMark className="google-mark" />
            <span className="btn-label">Sign in with Google</span>
          </Button>
        </div>
      )}
      {session.kind === "in" && (
        <div className="inline fade-enter">
          <a className={buttonClass({ variant: "primary", className: "session-go" })} href="/app/resume">
            <span className="btn-label">Open the workspace</span>
            {go}
          </a>
        </div>
      )}
      {}
      <p className="t-meta landing-end-status" role="status">
        {busy?.at === "end" ? progress(busy) : null}
      </p>
      {error?.at === "end" && (
        <p role="alert" className="inline-note" data-tone="alert">
          {error.text}
        </p>
      )}
    </div>
  );
}
