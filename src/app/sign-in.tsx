"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PublicConfig } from "@/lib/env";
import { browserClient } from "@/lib/supabase/browser";
import type { SessionUser } from "@/lib/supabase/server";

type State = { kind: "loading" } | { kind: "out" } | { kind: "in"; user: SessionUser };

// Signing in with Google and the anonymous demo. What the server sees is read back from /api/me, so the screen shows
// the session the routes will use, not only what the browser believes.
export function SignIn({ config, failed }: { config: PublicConfig; failed: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(failed ? "Signing in did not finish. Try again." : null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (response.status === 401) return setState({ kind: "out" });
    if (!response.ok) return setError("The server did not answer. Reload the page.");
    const body = (await response.json()) as { user: SessionUser };
    setState({ kind: "in", user: body.user });
  }

  useEffect(() => {
    // Reading the session here also refreshes it in the browser before the server is asked.
    browserClient(config)
      .auth.getSession()
      .then(() => refresh())
      .catch(() => setError("The server did not answer. Reload the page."));
  }, [config]);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    const redirectTo = new URL("/auth/callback", window.location.origin).toString();
    const { error } = await browserClient(config).auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(false);
      setError(`Google sign-in is not available: ${error.message}`);
    }
  }

  async function tryDemo() {
    setBusy(true);
    setError(null);
    const { error } = await browserClient(config).auth.signInAnonymously();
    setBusy(false);
    if (error) return setError(`The demo could not start: ${error.message}`);
    await refresh();
  }

  async function signOut() {
    setBusy(true);
    await browserClient(config).auth.signOut();
    setBusy(false);
    setState({ kind: "out" });
  }

  return (
    <section className="flex flex-col items-start gap-4" aria-live="polite">
      {state.kind === "loading" && <p>Checking your session…</p>}
      {state.kind === "out" && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={withGoogle} disabled={busy}>
            Sign in with Google
          </Button>
          <Button variant="outline" onClick={tryDemo} disabled={busy}>
            Try the demo
          </Button>
        </div>
      )}
      {state.kind === "in" && (
        <div className="flex flex-col gap-3" data-session={state.user.isAnonymous ? "anonymous" : "google"}>
          <p>
            Signed in {state.user.isAnonymous ? "to the demo" : `as ${state.user.email}`}.
          </p>
          <div className="flex gap-3">
            <a className={buttonVariants()} href="/app">
              Open the workspace
            </a>
            <Button variant="outline" onClick={signOut} disabled={busy}>
              Sign out
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
