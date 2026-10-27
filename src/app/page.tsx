import { Suspense } from "react";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { DEMO_FIRST_STEP } from "@/lib/demo";
import { publicConfig } from "@/lib/env";
import { SignIn, SignInPlaceholder } from "./sign-in";

// Read per request: the Supabase address and key come from the server's variables, not from the build.
async function SessionControls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const { auth } = await searchParams;
  return <SignIn config={publicConfig()} failed={auth === "failed"} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="landing">
      <div className="landing-copy">
        <div className="landing-top enter">
          <span className="brand" aria-hidden="true">
            <BrandMark className="brand-mark" />
            <span className="brand-name">client-workspace</span>
          </span>
          <ThemeSwitch />
        </div>
        <h1 className="t-h1 enter">Work organized by project, with everything each one needs in one place.</h1>
        <p className="t-body landing-lead enter">
          Tasks, decisions, links, and what is waiting for review live in the project they belong to, beside the calendars of every
          account it uses. A chat and your coding agent work on the same place, and say what they did.
        </p>
        <div className="session-slot enter">
          <Suspense fallback={<SignInPlaceholder />}>
            <SessionControls searchParams={searchParams} />
          </Suspense>
        </div>
        <section className="landing-first enter" data-first-step aria-labelledby="first-step-title">
          <p id="first-step-title" className="t-label">
            Inside the demo
          </p>
          <p className="t-value">
            The demo opens on <span className="t-name">{DEMO_FIRST_STEP}</span>.
          </p>
          <p className="t-help">
            Add a task with the field under Tasks, or ask the chat panel to add one for you. It is your own copy; nothing
            is shared.
          </p>
        </section>
      </div>
      <Preview />
    </main>
  );
}

// A project as the demo holds it, drawn with the product's own pieces: what the person will find after entering.
function Preview() {
  const rows = [
    { title: "Send the homepage draft for review", priority: "Urgent", tone: "alert", due: "Today", dueTone: "accent" },
    { title: "Collect product photos from the client", priority: "High", tone: "warn", due: "Yesterday", dueTone: "alert" },
    { title: "Map the pickup time slots", priority: "Normal", tone: undefined, due: "Tomorrow", dueTone: undefined },
  ];
  return (
    <figure className="landing-preview enter" aria-labelledby="preview-caption">
      <div className="card stack" inert>
        <p className="t-meta">Northwind Bakery</p>
        <p className="t-title">Website</p>
        <ul className="rows">
          {rows.map((row) => (
            <li key={row.title} className="row" data-type="task">
              <span className="row-check">
                <span className="check" aria-hidden="true" />
              </span>
              <span className="row-main">
                <span className="t-value">{row.title}</span>
              </span>
              <span className="row-chips">
                <span className="row-prio">
                  <span className="pill" data-tone={row.tone}>
                    {row.priority}
                  </span>
                </span>
                <span className="row-due">
                  <span className="pill" data-tone={row.dueTone}>
                    {row.due}
                  </span>
                </span>
              </span>
              <span className="row-act" />
            </li>
          ))}
        </ul>
        <div className="action-card">
          <span className="t-value">Created task “Confirm the delivery date with the client”</span>
          <span className="pill">By the chat</span>
        </div>
      </div>
      <figcaption id="preview-caption" className="t-meta">
        A project in the demo: its tasks by priority and due day, and what the chat did there.
      </figcaption>
    </figure>
  );
}
