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

export default function Home({ searchParams }: PageProps<"/">) {
  const shape = demoShape();
  // The seed dates its tasks by offsets from the visitor's day, so its Overview's figures are the same on any day.
  const figures = demoOverview("2026-01-01");
  return (
    <main className="landing">
      <div className="landing-copy">
        <div className="landing-top enter">
          {/* The brand is read by its name; the mark beside it is drawing only. */}
          <span className="brand">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
          <ThemeSwitch />
        </div>
        <h1 className="t-h1 enter">See your whole day, across every client and project.</h1>
        <p className="t-body landing-lead enter">
          Tasks, notes, calendars, and mail live with the client or project they belong to. A task that waits for mail shows
          the messages that may answer it, and you say which one did and how it ended.
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
            Its Overview opens on today&apos;s tasks, and its mail starts with the messages that may answer a task. Press Add
            task, or open Chat and ask what arrived for your tasks. Your own Google calendars show once you sign in with Google.
          </p>
        </section>
      </div>
      <LandingPreview figures={figures} />
    </main>
  );
}
