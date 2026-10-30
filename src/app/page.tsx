import { Suspense } from "react";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { demoOverview, demoShape } from "@/lib/demo-seed";
import { publicConfig } from "@/lib/env";
import { PRODUCT_NAME } from "@/lib/product";
import { LandingPreview } from "./landing-preview";
import { SignIn, SignInPlaceholder } from "./sign-in";
import "./styles/landing.css";

// Read per request: the Supabase address and key come from the server's variables, not from the build.
async function SessionControls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const { auth } = await searchParams;
  return <SignIn config={publicConfig()} failed={auth === "failed"} />;
}

// DRAFT: the title, the line and the demo's words below are copy waiting for the person who owns the product to approve
// them.
export default function Home({ searchParams }: PageProps<"/">) {
  const shape = demoShape();
  // The seed dates its tasks by offsets from the visitor's day, so its Overview's figures are the same on any day.
  const figures = demoOverview("2026-01-01");
  return (
    <main className="landing">
      <div className="landing-copy">
        <div className="landing-top enter">
          <span className="brand" aria-hidden="true">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
          <ThemeSwitch />
        </div>
        <h1 className="t-h1 enter">See your whole day, across every client and project.</h1>
        <p className="t-body landing-lead enter">
          Tasks, notes, calendars, and mail live with the client or project they belong to. Each day an AI reads the mail your
          tasks wait for, completes the ones whose message arrived, and tells you so, with Undo.
        </p>
        <div className="session-slot enter">
          <Suspense fallback={<SignInPlaceholder />}>
            <SessionControls searchParams={searchParams} />
          </Suspense>
        </div>
        <section className="landing-first enter" data-first-step aria-labelledby="first-step-title">
          <h2 id="first-step-title" className="t-title">
            Inside the demo
          </h2>
          <p className="t-body">
            A small agency&apos;s week: {shape.clients} clients, {shape.ownProjects} projects of its own, and the mail of its
            sample accounts.
          </p>
          <p className="t-help">
            Its Overview opens with what the daily review just did. Press Add task, or open Chat and ask it to review your day.
            Your own Google calendars show once you sign in with Google.
          </p>
        </section>
      </div>
      <LandingPreview figures={figures} />
    </main>
  );
}
