"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { Button, buttonClass } from "@/components/ui/button";
import type { PublicConfig } from "@/lib/env";
import type { Language } from "@/lib/language";
import { dayOf } from "@/lib/dates";
import { browserClient } from "@/lib/supabase/browser";
import { signInWithGoogle } from "@/lib/supabase/google-sign-in";
import type { SessionUser } from "@/lib/supabase/server";
import { trackDemoStart, trackSignIn, trackSignOut } from "@/lib/analytics";
import { askOnceMoreIfCut, forgetLayout } from "./app/client-api";

type Session = { kind: "loading" } | { kind: "out" } | { kind: "in"; user: SessionUser };
type Spot = "nav" | "hero" | "end";
type Way = { session: Session; busy: { what: "google" | "demo" | "out"; at: Spot } | null; error: { text: string; at: Spot } | null };

const START: Way = { session: { kind: "loading" }, busy: null, error: null };

const TEXT = {
  en: {
    noAnswer: "The server did not answer. Reload the page.",
    preparing: "Preparing a demo workspace of your own…",
    openingGoogle: "Opening Google…",
    checking: "Checking your session",
    tryDemo: "Try the demo",
    signInGoogle: "Sign in with Google",
    signIn: "Sign in",
    openWorkspace: "Open the workspace",
    signOut: "Sign out",
    demoNote: "The demo is a workspace of your own with sample clients and projects; nothing is shared.",
    signedDemo: "Signed in to the demo.",
    signedAs: "Signed in as",
    signInFailed: "Signing in did not finish. Try again.",
    googleUnavailable: "Google sign-in is not available",
    demoStartFailed: "The demo could not start",
    demoPrepareFailed: "The demo workspace could not be prepared. Reload to try again.",
  },
  es: {
    noAnswer: "El servidor no respondió. Conviene recargar la página.",
    preparing: "Preparando un espacio de trabajo de demostración propio…",
    openingGoogle: "Abriendo Google…",
    checking: "Comprobando la sesión",
    tryDemo: "Probar la demostración",
    signInGoogle: "Iniciar sesión con Google",
    signIn: "Iniciar sesión",
    openWorkspace: "Abrir el espacio de trabajo",
    signOut: "Cerrar sesión",
    demoNote: "La demostración es un espacio de trabajo propio con clientes y proyectos de muestra; nada se comparte.",
    signedDemo: "Sesión iniciada en la demostración.",
    signedAs: "Sesión iniciada como",
    signInFailed: "El inicio de sesión no se completó. Conviene intentarlo de nuevo.",
    googleUnavailable: "El inicio de sesión con Google no está disponible",
    demoStartFailed: "La demostración no se pudo iniciar",
    demoPrepareFailed: "El espacio de trabajo de demostración no se pudo preparar. Conviene recargar para intentarlo de nuevo.",
  },
} as const;

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

async function readSession(config: PublicConfig, of: number, lang: Language) {
  try {
    const { data } = await browserClient(config).auth.getSession();
    if (!data.session) return put({ session: { kind: "out" } }, of);
    const response = await askOnceMoreIfCut("/api/me", {});
    if (response instanceof Response && response.status === 401) return put({ session: { kind: "out" } }, of);
    if (!(response instanceof Response) || !response.ok) return put({ error: { text: TEXT[lang].noAnswer, at: "hero" } }, of);
    const body = (await response.json()) as { user: SessionUser };
    put({ session: { kind: "in", user: body.user } }, of);
  } catch {
    put({ error: { text: TEXT[lang].noAnswer, at: "hero" } }, of);
  }
}

function useWay(config: PublicConfig, lang: Language): Way {
  const current = useSyncExternalStore(subscribe, () => way, () => START);
  useEffect(() => {
    readers += 1;
    if (readers === 1) {
      round += 1;
      way = START;
      void readSession(config, round, lang);
    }
    return () => {
      readers -= 1;
      if (readers > 0) return;
      round += 1;
      way = START;
    };
  }, [config, lang]);
  return current;
}

async function withGoogle(config: PublicConfig, at: Spot, lang: Language) {
  const of = round;
  trackSignIn(at);
  put({ busy: { what: "google", at }, error: null }, of);
  const { error } = await signInWithGoogle(config);
  if (error) put({ busy: null, error: { text: `${TEXT[lang].googleUnavailable}: ${error.message}`, at } }, of);
}

async function tryDemo(config: PublicConfig, at: Spot, enter: () => void, lang: Language) {
  const of = round;
  trackDemoStart(at);
  const fail = (text: string) => put({ busy: null, error: { text, at } }, of);
  put({ busy: { what: "demo", at }, error: null }, of);
  const { data: existing } = await browserClient(config).auth.getSession();
  if (!existing.session?.user.is_anonymous) {
    const { error } = await browserClient(config).auth.signInAnonymously();
    if (error) return fail(`${TEXT[lang].demoStartFailed}: ${error.message}`);
  }
  const seeded = await askOnceMoreIfCut("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ today: dayOf(new Date()), zone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  if (!(seeded instanceof Response) || !seeded.ok) return fail(TEXT[lang].demoPrepareFailed);
  enter();
}

async function signOut(config: PublicConfig) {
  const of = round;
  trackSignOut();
  put({ busy: { what: "out", at: "hero" } }, of);
  await forgetLayout();
  await browserClient(config).auth.signOut();
  put({ busy: null, session: { kind: "out" } }, of);
}

function progress(busy: Way["busy"], lang: Language): string | null {
  return busy?.what === "demo" ? TEXT[lang].preparing : busy?.what === "google" ? TEXT[lang].openingGoogle : null;
}

export function SignInPlaceholder({ lang = "en" }: { lang?: Language }) {
  return (
    <div className="stack" role="status" aria-busy="true" aria-label={TEXT[lang].checking}>
      <span className="inline">
        <span className="skeleton session-skeleton" data-for="demo" />
        <span className="skeleton session-skeleton" data-for="google" />
      </span>
    </div>
  );
}

export function SignIn({ config, failed, go, lang = "en" }: { config: PublicConfig; failed: boolean; go?: ReactNode; lang?: Language }) {
  const { session, busy, error } = useWay(config, lang);
  const router = useRouter();
  const t = TEXT[lang];

  useEffect(() => {
    if (failed) put({ error: { text: t.signInFailed, at: "hero" } }, round);
  }, [failed, t.signInFailed]);

  const said = busy && busy.at !== "end" ? progress(busy, lang) : null;
  return (
    <section className="stack">
      {session.kind === "loading" && <SignInPlaceholder lang={lang} />}
      {session.kind === "out" && (
        <div className="inline fade-enter">
          <Button
            variant="primary"
            className="session-go"
            onClick={() => void tryDemo(config, "hero", () => router.push("/app/resume"), lang)}
            disabled={busy !== null}
            aria-busy={busy?.what === "demo" && busy.at === "hero"}
          >
            <span className="btn-label">{t.tryDemo}</span>
            {go}
          </Button>
          <Button onClick={() => void withGoogle(config, "hero", lang)} disabled={busy !== null} aria-busy={busy?.what === "google" && busy.at === "hero"}>
            <GoogleMark className="google-mark" />
            <span className="btn-label">{t.signInGoogle}</span>
          </Button>
        </div>
      )}
      {session.kind === "out" && (
        <p className="t-meta" role="status">
          {said ?? t.demoNote}
        </p>
      )}
      {session.kind === "in" && (
        <div className="stack fade-enter" data-session={session.user.isAnonymous ? "anonymous" : "google"}>
          <div className="inline">
            <a className={buttonClass({ variant: "primary", className: "session-go" })} href="/app/resume">
              <span className="btn-label">{t.openWorkspace}</span>
              {go}
            </a>
            <Button onClick={() => void signOut(config)} disabled={busy !== null}>
              {t.signOut}
            </Button>
          </div>
          <p className="t-meta">
            {session.user.isAnonymous ? (
              t.signedDemo
            ) : lang === "es" ? (
              <>
                {t.signedAs} <span className="t-name">{session.user.email}</span>.
              </>
            ) : (
              <>
                Signed in as <span className="t-name">{session.user.email}</span>.
              </>
            )}
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

export function NavSignInPlaceholder({ lang = "en" }: { lang?: Language }) {
  return (
    <span className="landing-nav-session" aria-hidden="true">
      <span className={buttonClass({ variant: "quiet", className: "landing-nav-sign-in" })}>
        <span className="btn-label">{TEXT[lang].signIn}</span>
      </span>
      <span className={buttonClass({ variant: "primary" })}>
        <span className="btn-label">{TEXT[lang].tryDemo}</span>
      </span>
    </span>
  );
}

export function NavSignIn({ config, lang = "en" }: { config: PublicConfig; lang?: Language }) {
  const { session, busy, error } = useWay(config, lang);
  const router = useRouter();
  const t = TEXT[lang];
  if (session.kind === "loading") return <NavSignInPlaceholder lang={lang} />;
  if (session.kind === "in") {
    return (
      <a className={buttonClass({ variant: "primary", className: "landing-nav-open fade-enter" })} href="/app/resume">
        <span className="btn-label">{t.openWorkspace}</span>
      </a>
    );
  }
  return (
    <span className="landing-nav-session fade-enter" data-ready="">
      <Button
        variant="quiet"
        className="landing-nav-sign-in"
        onClick={() => void withGoogle(config, "nav", lang)}
        disabled={busy !== null}
        aria-busy={busy?.what === "google" && busy.at === "nav"}
      >
        {t.signIn}
      </Button>
      <Button
        variant="primary"
        onClick={() => void tryDemo(config, "nav", () => router.push("/app/resume"), lang)}
        disabled={busy !== null}
        aria-busy={busy?.what === "demo" && busy.at === "nav"}
      >
        {t.tryDemo}
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

export function EndSignIn({ config, go, lang = "en" }: { config: PublicConfig; go?: ReactNode; lang?: Language }) {
  const { session, busy, error } = useWay(config, lang);
  const router = useRouter();
  const t = TEXT[lang];
  return (
    <div className="stack">
      {session.kind === "loading" && <EndSignInPlaceholder />}
      {session.kind === "out" && (
        <div className="inline fade-enter">
          <Button
            variant="primary"
            className="session-go"
            onClick={() => void tryDemo(config, "end", () => router.push("/app/resume"), lang)}
            disabled={busy !== null}
            aria-busy={busy?.what === "demo" && busy.at === "end"}
          >
            <span className="btn-label">{t.tryDemo}</span>
            {go}
          </Button>
          <Button onClick={() => void withGoogle(config, "end", lang)} disabled={busy !== null} aria-busy={busy?.what === "google" && busy.at === "end"}>
            <GoogleMark className="google-mark" />
            <span className="btn-label">{t.signInGoogle}</span>
          </Button>
        </div>
      )}
      {session.kind === "in" && (
        <div className="inline fade-enter">
          <a className={buttonClass({ variant: "primary", className: "session-go" })} href="/app/resume">
            <span className="btn-label">{t.openWorkspace}</span>
            {go}
          </a>
        </div>
      )}
      <p className="t-meta landing-end-status" role="status">
        {busy?.at === "end" ? progress(busy, lang) : null}
      </p>
      {error?.at === "end" && (
        <p role="alert" className="inline-note" data-tone="alert">
          {error.text}
        </p>
      )}
    </div>
  );
}
