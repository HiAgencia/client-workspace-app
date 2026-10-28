"use client";

import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import type { PublicConfig } from "@/lib/env";
import { dayOf } from "@/lib/dates";
import { browserClient } from "@/lib/supabase/browser";
import type { SessionUser } from "@/lib/supabase/server";

type State = { kind: "loading" } | { kind: "out" } | { kind: "in"; user: SessionUser };

// The box the session's controls will take, held while the session is read, so nothing below moves when they arrive.
export function SignInPlaceholder() {
  return (
    <div className="stack" role="status" aria-busy="true" aria-label="Checking your session">
      <span className="inline">
        <span className="skeleton" style={{ width: "9.5rem", height: "2.6rem" }} />
        <span className="skeleton" style={{ width: "11.5rem", height: "2.6rem" }} />
      </span>
    </div>
  );
}

// Signing in with Google and the anonymous demo. What the server sees is read back from /api/me, so the screen shows
// the session the routes will use, not only what the browser believes.
export function SignIn({ config, failed }: { config: PublicConfig; failed: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(failed ? "Signing in did not finish. Try again." : null);
  const [busy, setBusy] = useState<"google" | "demo" | "out" | null>(null);

  async function refresh() {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (response.status === 401) return setState({ kind: "out" });
    if (!response.ok) return setError("The server did not answer. Reload the page.");
    const body = (await response.json()) as { user: SessionUser };
    setState({ kind: "in", user: body.user });
  }

  useEffect(() => {
    // Reading the session here also refreshes it in the browser; without one there is nothing to ask the server.
    browserClient(config)
      .auth.getSession()
      .then(({ data }) => (data.session ? refresh() : setState({ kind: "out" })))
      .catch(() => setError("The server did not answer. Reload the page."));
  }, [config]);

  async function withGoogle() {
    setBusy("google");
    setError(null);
    const redirectTo = new URL("/auth/callback", window.location.origin).toString();
    const { error } = await browserClient(config).auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(null);
      setError(`Google sign-in is not available: ${error.message}`);
    }
  }

  async function tryDemo() {
    setBusy("demo");
    setError(null);
    // A demo session left by a seed that failed is reused: trying again plants into it instead of opening a second
    // anonymous session and leaving the first one orphaned.
    const { data: existing } = await browserClient(config).auth.getSession();
    if (!existing.session?.user.is_anonymous) {
      const { error } = await browserClient(config).auth.signInAnonymously();
      if (error) {
        setBusy(null);
        return setError(`The demo could not start: ${error.message}`);
      }
    }
    // Each visitor gets their own copy of the demo workspace, dated from their own calendar day.
    const seeded = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ today: dayOf(new Date()) }),
    });
    setBusy(null);
    if (!seeded.ok) return setError("The demo workspace could not be prepared. Reload to try again.");
    await refresh();
  }

  async function signOut() {
    setBusy("out");
    await browserClient(config).auth.signOut();
    setBusy(null);
    setState({ kind: "out" });
  }

  return (
    <section className="stack" aria-live="polite">
      {state.kind === "loading" && <SignInPlaceholder />}
      {state.kind === "out" && (
        <div className="inline fade-enter">
          <Button variant="primary" onClick={() => void tryDemo()} disabled={busy !== null} aria-busy={busy === "demo"}>
            Try the demo
          </Button>
          <Button onClick={() => void withGoogle()} disabled={busy !== null} aria-busy={busy === "google"}>
            Sign in with Google
          </Button>
        </div>
      )}
      {state.kind === "out" && (
        <p className="t-meta" role="status">
          {busy === "demo"
            ? "Preparing a demo workspace of your own…"
            : busy === "google"
              ? "Opening Google…"
              : "The demo is a workspace of your own with sample clients and projects; nothing is shared."}
        </p>
      )}
      {state.kind === "in" && (
        <div className="stack fade-enter" data-session={state.user.isAnonymous ? "anonymous" : "google"}>
          <div className="inline">
            <a className={buttonClass({ variant: "primary" })} href="/app/resume">
              <span className="btn-label">Open the workspace</span>
            </a>
            <Button onClick={() => void signOut()} disabled={busy !== null}>
              Sign out
            </Button>
          </div>
          <p className="t-meta">
            Signed in {state.user.isAnonymous ? "to the demo" : <>as <span className="t-name">{state.user.email}</span></>}.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          {error}
        </p>
      )}
    </section>
  );
}
