import { Suspense } from "react";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { demoShape } from "@/lib/demo-seed";
import { publicConfig } from "@/lib/env";
import { SignIn, SignInPlaceholder } from "./sign-in";

// Read per request: the Supabase address and key come from the server's variables, not from the build.
async function SessionControls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const { auth } = await searchParams;
  return <SignIn config={publicConfig()} failed={auth === "failed"} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  const shape = demoShape();
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
          Tasks, decisions, links, and what waits for review live in the project they belong to, next to the calendars of the Google
          accounts connected to it. A chat and your coding agent work in the same projects: they add tasks, record decisions, and
          say what they did.
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
            The demo opens on the Overview of a small agency: {shape.clients} clients and {shape.ownProjects} projects of its own.
          </p>
          <p className="t-help">
            Add a task with the field under Tasks, or open the chat and ask it to add one for you. Google calendars show once you
            sign in with Google.
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
    { title: "Confirm the delivery date with the client", priority: "Normal", tone: undefined, due: "Tomorrow", dueTone: undefined },
  ];
  return (
    <figure className="landing-preview enter" aria-labelledby="preview-caption">
      <div className="card stack" inert>
        <p className="t-meta">Larkspur Bakery</p>
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
            </li>
          ))}
        </ul>
        <div className="action-card">
          <span className="t-value">Added task “Confirm the delivery date with the client”</span>
          <span className="pill">By the chat</span>
        </div>
      </div>
      <figcaption id="preview-caption" className="t-meta">
        A project in the demo: its tasks by priority and due date, and what the chat did there.
      </figcaption>
    </figure>
  );
}
