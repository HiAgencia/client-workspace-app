import { Suspense } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { OrgJsonLd } from "@/components/org-json-ld";
import { SiteFoot } from "./site-foot";
import { GmailMark, GoogleCalendarMark, McpMark, MetaMark } from "@/components/ui/brands";
import { DarkIcon, LightIcon, OpenIcon } from "@/components/ui/icons";
import { demoOverview, demoShape } from "@/lib/demo-seed";
import { publicConfig } from "@/lib/env";
import type { Language } from "@/lib/language";
import { ASSISTANT_MODELS, PRODUCT_NAME } from "@/lib/product";
import { LandingNav, ThemeButton } from "./landing-nav";
import { LandingShot } from "./landing-shot";
import { LandingStories } from "./landing-stories";
import { LanguageOffer } from "./language-offer";
import { LanguageSwitch } from "./language-switch";
import { EndSignIn, EndSignInPlaceholder, NavSignIn, NavSignInPlaceholder, SignIn, SignInPlaceholder } from "./sign-in";
import "./styles/boxes.css";
import "./styles/task.css";
import "./styles/mail.css";
import "./styles/landing.css";

async function SessionControls({ failed, lang }: { failed: Promise<boolean>; lang: Language }) {
  await connection();
  return <SignIn config={publicConfig()} failed={await failed} go={<OpenIcon />} lang={lang} />;
}

async function NavSessionControls({ lang }: { lang: Language }) {
  await connection();
  return <NavSignIn config={publicConfig()} lang={lang} />;
}

async function EndSessionControls({ lang }: { lang: Language }) {
  await connection();
  return <EndSignIn config={publicConfig()} go={<OpenIcon />} lang={lang} />;
}

async function mcpEndpoint(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost";
  const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? (list.get("x-forwarded-proto") ?? "http") : "https";
  return `${scheme}://${host}/api/mcp`;
}

function WorksWith({ lang }: { lang: Language }) {
  const es = lang === "es";
  const services = [
    { Mark: GmailMark, name: "Gmail", what: es ? "El correo de cada cuenta" : "Every account’s mail" },
    { Mark: GoogleCalendarMark, name: "Google Calendar", what: es ? "Las reuniones de cada cuenta" : "Every account’s meetings" },
    { Mark: MetaMark, name: es ? "Los modelos Muse de Meta" : ASSISTANT_MODELS, what: es ? "El chat, cuando se le pide" : "The chat, when you ask" },
    { Mark: McpMark, name: es ? "Cualquier agente de código con MCP" : "Any MCP coding agent", what: es ? "En los mismos proyectos" : "On the same projects" },
  ];
  return (
    <section className="works" aria-labelledby="works-title">
      <h2 id="works-title" className="works-title">
        {es ? "Funciona con" : "Works with"}
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

export async function LandingHome({ lang, failed }: { lang: Language; failed: Promise<boolean> }) {
  const es = lang === "es";
  const shape = demoShape();
  const figures = demoOverview("2026-01-01");
  const endpoint = await mcpEndpoint();
  return (
    <div className="landing">
      <OrgJsonLd />
      <LandingNav>
        <div className="landing-wrap landing-nav-in enter">
          <span className="brand landing-brand">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
          <div className="landing-nav-actions">
            <Suspense fallback={<NavSignInPlaceholder lang={lang} />}>
              <NavSessionControls lang={lang} />
            </Suspense>
            <LanguageSwitch lang={lang} path="" />
            <ThemeButton toDark={<DarkIcon data-to="dark" />} toLight={<LightIcon data-to="light" />} />
          </div>
        </div>
      </LandingNav>
      <main className="landing-main">
        {!es && <LanguageOffer path="" />}
        <section className="landing-hero landing-wrap" aria-labelledby="landing-title">
          <h1 id="landing-title" className="landing-title enter">
            {es ? "Cada cliente en un solo lugar." : "Every client in one place."}
          </h1>
          <div className="landing-intro">
            <p className="landing-lead enter">
              {es ? (
                "Tareas, calendarios y correo de cada cuenta de Google en uso, con un chat con los modelos Muse de Meta y un MCP para el agente de código."
              ) : (
                <>
                  Tasks, calendars and mail from every Google account your clients use, with a chat on {ASSISTANT_MODELS} and an MCP for your coding agent.
                </>
              )}
            </p>
            <div className="session-slot enter">
              <Suspense fallback={<SignInPlaceholder lang={lang} />}>
                <SessionControls failed={failed} lang={lang} />
              </Suspense>
            </div>
          </div>
        </section>
        <div className="landing-wrap">
          <LandingShot
            figures={figures}
            lang={lang}
            caption={
              es
                ? `El Resumen de la demostración: una agencia pequeña con ${shape.clients} clientes y ${shape.ownProjects} proyectos propios, mientras llega un mensaje para la tarea que lo espera.`
                : `The demo’s Overview: a small agency with ${shape.clients} clients and ${shape.ownProjects} projects of its own, as a message arrives for the task that waits for it.`
            }
          />
        </div>
        <div className="landing-wrap">
          <WorksWith lang={lang} />
          <LandingStories endpoint={endpoint} lang={lang} />
        </div>
        <section className="landing-end landing-wrap" aria-labelledby="landing-end-title">
          <h2 id="landing-end-title" className="landing-end-title">
            {es ? "La demostración es una semana en una agencia pequeña." : "The demo is a week at a small agency."}
          </h2>
          <p className="landing-end-lead">
            {es
              ? `${shape.clients} clientes y ${shape.ownProjects} proyectos propios, con sus tareas, su correo y sus reuniones, en un espacio de trabajo privado.`
              : `${shape.clients} clients and ${shape.ownProjects} projects of its own, with their tasks, mail and meetings, in a workspace only you see.`}
          </p>
          <div className="landing-end-session">
            <Suspense fallback={<EndSignInPlaceholder />}>
              <EndSessionControls lang={lang} />
            </Suspense>
          </div>
        </section>
      </main>
      <SiteFoot lang={lang} />
    </div>
  );
}
