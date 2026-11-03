import { Suspense } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { GmailMark, GoogleCalendarMark, McpMark, MetaMark } from "@/components/ui/brands";
import { DarkIcon, LightIcon, OpenIcon } from "@/components/ui/icons";
import { demoOverview, demoShape } from "@/lib/demo-seed";
import { publicConfig } from "@/lib/env";
import { ASSISTANT_MODELS, PRODUCT_NAME } from "@/lib/product";
import { LandingNav, ThemeButton } from "./landing-nav";
import { LandingShot } from "./landing-shot";
import { LandingStories } from "./landing-stories";
import { EndSignIn, EndSignInPlaceholder, NavSignIn, NavSignInPlaceholder, SignIn, SignInPlaceholder } from "./sign-in";
import "./styles/boxes.css";
import "./styles/task.css";
import "./styles/mail.css";
import "./styles/landing.css";




async function SessionControls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const { auth } = await searchParams;
  return <SignIn config={publicConfig()} failed={auth === "failed"} go={<OpenIcon />} />;
}

async function NavSessionControls() {
  await connection();
  return <NavSignIn config={publicConfig()} />;
}

async function EndSessionControls() {
  await connection();
  return <EndSignIn config={publicConfig()} go={<OpenIcon />} />;
}


async function mcpEndpoint(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost";
  const scheme = list.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${scheme}://${host}/api/mcp`;
}


function WorksWith() {
  const services = [
    { Mark: GmailMark, name: "Gmail", what: "Every account’s mail" },
    { Mark: GoogleCalendarMark, name: "Google Calendar", what: "Every account’s meetings" },
    { Mark: MetaMark, name: ASSISTANT_MODELS, what: "The chat, when you ask" },
    { Mark: McpMark, name: "Any MCP coding agent", what: "On the same projects" },
  ];
  return (
    <section className="works" aria-labelledby="works-title">
      <h2 id="works-title" className="works-title">
        Works with
      </h2>
      <ul className="works-list">
        {services.map(({ Mark, name, what }) => (
          <li key={name} className="works-item">
            <span className="works-mark">
              <Mark />
            </span>
            <span className="works-name">{name}</span>
            <span className="works-what">{what}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const shape = demoShape();
  
  const figures = demoOverview("2026-01-01");
  const endpoint = await mcpEndpoint();
  return (
    <div className="landing">
      <LandingNav>
        <div className="landing-wrap landing-nav-in enter">
          {}
          <span className="brand landing-brand">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
          <div className="landing-nav-actions">
            <Suspense fallback={<NavSignInPlaceholder />}>
              <NavSessionControls />
            </Suspense>
            <ThemeButton toDark={<DarkIcon data-to="dark" />} toLight={<LightIcon data-to="light" />} />
          </div>
        </div>
      </LandingNav>
      <main className="landing-main">
        <section className="landing-hero landing-wrap" aria-labelledby="landing-title">
          <h1 id="landing-title" className="landing-title enter">
            Every client in one place.
          </h1>
          <div className="landing-intro">
            <p className="landing-lead enter">
              Tasks, calendars and mail from every Google account your clients use, with a chat on {ASSISTANT_MODELS} and an
              MCP for your coding agent.
            </p>
            <div className="session-slot enter">
              <Suspense fallback={<SignInPlaceholder />}>
                <SessionControls searchParams={searchParams} />
              </Suspense>
            </div>
          </div>
        </section>
        <div className="landing-wrap">
          <LandingShot
            figures={figures}
            caption={`The demo’s Overview: a small agency with ${shape.clients} clients and ${shape.ownProjects} projects of its own, as a message arrives for the task that waits for it.`}
          />
        </div>
        <div className="landing-wrap">
          <WorksWith />
          <LandingStories endpoint={endpoint} />
        </div>
        <section className="landing-end landing-wrap" aria-labelledby="landing-end-title">
          <h2 id="landing-end-title" className="landing-end-title">
            The demo is a week at a small agency.
          </h2>
          <p className="landing-end-lead">
            {shape.clients} clients and {shape.ownProjects} projects of its own, with their tasks, mail and meetings, in a workspace only
            you see.
          </p>
          <div className="landing-end-session">
            <Suspense fallback={<EndSignInPlaceholder />}>
              <EndSessionControls />
            </Suspense>
          </div>
        </section>
      </main>
      <footer className="landing-foot">
        <div className="landing-wrap landing-foot-in">
          <span className="brand">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
          <p className="t-meta">Built for the Meta Global AI Developer Hackathon.</p>
        </div>
      </footer>
    </div>
  );
}
