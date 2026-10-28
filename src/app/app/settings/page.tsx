"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { LOCALE } from "@/lib/dates";
import { Empty } from "../blocks";
import { get, post } from "../client-api";
import { ConfirmButton } from "../confirm-button";
import { ConnectBlockedNote, type ConnectBlocked } from "../connect-blocked";
import { useWorkspace } from "../workspace";

// Settings: the theme, the Google accounts whose calendars show in each client and project, and the tokens coding agents
// use to read and write a client or a project.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <ViewTransition enter="page-in" exit="page-out" default="none">
        <div className="page">
          <header className="card page-head">
            <h1 className="t-h1" tabIndex={-1}>
              Settings
            </h1>
            <p className="t-help">The theme, the Google accounts whose calendars show in each client and project, and the tokens your coding agents use.</p>
          </header>
          <ThemeSection />
          <AccountsSection />
          <AgentTokensSection />
        </div>
      </ViewTransition>
    </Suspense>
  );
}

function ThemeSection() {
  return (
    <section className="card stack" aria-labelledby="theme" id="theme-settings">
      <h2 id="theme" className="t-title">
        Theme
      </h2>
      <div className="settings-line">
        <p className="t-help">Light or dark. It follows your system until you choose, and your choice applies to every open tab.</p>
        <ThemeSwitch />
      </div>
    </section>
  );
}

type Calendar = { id: string; name: string; color: string | null; selected: boolean };
type Account = { id: string; email: string; status: string; isDemo: boolean; nodeIds: string[]; calendars: Calendar[] };

// The connected Google accounts, the clients and projects each is connected to, and which calendars are shown.
function AccountsSection() {
  const { tree, saving, version } = useWorkspace();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [canConnect, setCanConnect] = useState(false);
  const [connectBlocked, setConnectBlocked] = useState<ConnectBlocked>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectNode, setConnectNode] = useState<string | null>(null);

  useEffect(() => {
    void get<{ accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked }>("/api/accounts").then((answer) => {
      if (answer.ok) {
        setAccounts(answer.accounts);
        setCanConnect(answer.canConnect);
        setConnectBlocked(answer.connectBlocked);
        setError(null);
      } else setError(answer.message);
    });
  }, [version]);

  const act = (body: Record<string, unknown>) => saving(post("/api/accounts", body));
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A place no longer listed";
  const nodeOptions = (tree ?? []).map((node) => ({ value: node.id, label: node.path }));

  return (
    <section className="card stack" aria-labelledby="accounts" id="accounts-settings">
      <h2 id="accounts" className="t-title">
        Google accounts
      </h2>
      <p className="t-help">Connect an account to a client or a project to see its calendars there, and in its projects and subprojects.</p>
      {canConnect ? (
        <div className="inline" aria-label="Connect an account" role="group">
          <Select id="connect-where" label="Where the account connects" placeholder="Client or project…" value={connectNode} options={nodeOptions} onChange={setConnectNode} />
          {connectNode ? (
            <a className={buttonClass({ variant: "primary" })} href={`/api/google/connect?node=${connectNode}`}>
              <span className="btn-label">Connect a Google account</span>
            </a>
          ) : (
            <Button variant="primary" disabled aria-describedby="connect-why">
              Connect a Google account
            </Button>
          )}
          {!connectNode && (
            <span id="connect-why" className="t-help">
              Pick a client or a project first.
            </span>
          )}
        </div>
      ) : (
        // With no accounts, the reason is the empty list's own answer, said once below.
        accounts && accounts.length > 0 && <ConnectBlockedNote reason={connectBlocked} />
      )}
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          The accounts could not be {accounts ? "refreshed" : "read"}: {error}.
        </p>
      )}
      {!accounts ? (
        !error && (
          <div className="stack" role="status" aria-label="Loading accounts" aria-busy="true">
            <span className="skeleton" style={{ width: "58%" }} />
            <span className="skeleton" style={{ width: "46%" }} />
          </div>
        )
      ) : accounts.length === 0 ? (
        <div className="fade-enter" data-accounts-empty>
          <div className="empty">
            <p className="t-help">No Google accounts connected yet.</p>
            {!canConnect && <ConnectBlockedNote reason={connectBlocked} />}
          </div>
        </div>
      ) : (
        <ul className="plain-list stack fade-enter">
          {accounts.map((account) => (
            <li key={account.id} className="settings-entry stack">
              <div className="page-head-row">
                <h3 className="t-name">{account.email}</h3>
                {account.status !== "active" && (
                  <span className="pill" data-tone="alert">
                    {account.status === "revoked" ? "Access revoked: connect it again" : account.status}
                  </span>
                )}
                {account.isDemo && <span className="pill">Sample account, read-only</span>}
              </div>
              <div className="stack">
                <h4 className="t-label">Connected to</h4>
                <ul className="plain-list stack">
                  {account.nodeIds.map((nodeId) => (
                    <li key={nodeId} className="account-line">
                      <span className="t-value">{path(nodeId)}</span>
                      {!account.isDemo && (
                        <Button variant="quiet" size="sm" onClick={() => void act({ action: "detach", accountId: account.id, nodeId })}>
                          Detach
                        </Button>
                      )}
                    </li>
                  ))}
                  {account.nodeIds.length === 0 && <li className="t-help">No client or project yet: its calendars show nowhere until it is connected to one.</li>}
                </ul>
                {!account.isDemo && (
                  <Select
                    label={`Also show ${account.email} in`}
                    placeholder="Also show it in…"
                    value={null}
                    options={nodeOptions.filter((option) => !account.nodeIds.includes(option.value))}
                    onChange={(nodeId) => void act({ action: "attach", accountId: account.id, nodeId })}
                  />
                )}
              </div>
              <fieldset className="stack">
                <legend className="t-label">Calendars shown</legend>
                {account.calendars.length === 0 && <p className="t-help">This account shared no calendars.</p>}
                {account.calendars.map((calendar) => (
                  <span key={calendar.id} className="check-row">
                    <Checkbox
                      checked={calendar.selected}
                      disabled={account.isDemo}
                      aria-labelledby={`calendar-${calendar.id}`}
                      onCheckedChange={() => void act({ action: "select_calendar", accountId: account.id, calendarId: calendar.id, selected: !calendar.selected })}
                    />
                    <span className="calendar-swatch" style={{ "--swatch": calendar.color ?? undefined } as React.CSSProperties} aria-hidden="true" />
                    <span id={`calendar-${calendar.id}`} className="t-value">
                      {calendar.name}
                    </span>
                  </span>
                ))}
              </fieldset>
              {!account.isDemo && (
                <div>
                  <ConfirmButton
                    confirm={`${account.email} leaves every client and project, and its access is deleted. This cannot be undone.`}
                    onConfirm={() => void act({ action: "disconnect", accountId: account.id })}
                  >
                    Disconnect
                  </ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Token = { id: string; nodeId: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Tokens = { tokens: Token[]; mcpJson: string; tokenEnv: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Agent tokens: a coding agent with a token reads and writes the client or project it was issued for, its projects or
// subprojects included. Each token is shown once, named after where it runs, and revoked when the agent no longer needs it.
function AgentTokensSection() {
  const { tree, saving } = useWorkspace();
  const asked = useSearchParams().get("node");
  const [data, setData] = useState<Tokens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(asked);
  const [label, setLabel] = useState("");
  const [missing, setMissing] = useState<"node" | "label" | null>(null);
  const [issued, setIssued] = useState<{ token: string; path: string } | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    void get<Tokens>("/api/agent-tokens").then((answer) => {
      if (answer.ok) {
        setData(answer);
        setError(null);
      } else setError(answer.message);
    });
  }, [reads]);

  // Coming from a client's or a project's page, the section takes the view with that place chosen, and the focus goes to
  // the token's name, the one thing left to write.
  useEffect(() => {
    if (!asked || window.location.hash !== "#agent-tokens") return;
    requestAnimationFrame(() => {
      document.getElementById("agent-tokens")?.scrollIntoView({ block: "start", behavior: "instant" });
      document.getElementById("token-name")?.focus({ preventScroll: true });
    });
  }, [asked]);

  async function issue() {
    if (!nodeId) return setMissing("node");
    if (!label.trim()) return setMissing("label");
    setMissing(null);
    const answer = await post<{ token: string }>("/api/agent-tokens", { action: "issue", nodeId, label });
    if (await saving(Promise.resolve(answer))) {
      if (answer.ok) setIssued({ token: answer.token, path: tree?.find((node) => node.id === nodeId)?.path ?? "" });
      setLabel("");
      setReads((n) => n + 1);
    }
  }

  async function revoke(tokenId: string) {
    if (await saving(post("/api/agent-tokens", { action: "revoke", id: tokenId }))) setReads((n) => n + 1);
  }

  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A place no longer listed";
  return (
    <section className="card stack" aria-labelledby="agent-tokens-title" id="agent-tokens">
      <h2 id="agent-tokens-title" className="t-title" tabIndex={-1}>
        Agent tokens
      </h2>
      <p className="t-help">
        A token lets a coding agent read and update one client or project, its projects or subprojects included: its tasks, its decisions, and what
        changed. Each token is shown once; revoke it when the agent no longer needs it.
      </p>
      <div className="quick-add">
        <div className="quick-add-where">
          <Select
            id="token-where"
            label="What the token reaches"
            placeholder="Pick a client or a project…"
            value={nodeId}
            options={(tree ?? []).map((node) => ({ value: node.id, label: node.path }))}
            onChange={(value) => {
              setNodeId(value);
              if (missing === "node") setMissing(null);
            }}
          />
        </div>
        <Field
          id="token-name"
          name="token-name"
          aria-label="Token name"
          aria-describedby="token-name-help"
          aria-invalid={missing === "label" || undefined}
          placeholder="Token name, such as laptop"
          className="grow"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void issue()}
        />
        <Button variant="primary" onClick={() => void issue()}>
          Issue an agent token
        </Button>
      </div>
      <p id="token-name-help" className={missing ? "inline-note" : "t-help"} data-tone={missing ? "alert" : undefined}>
        {missing === "node"
          ? "Pick the client or project the token reaches."
          : missing === "label"
            ? "Name the token after where the agent runs, such as laptop."
            : "The name appears beside everything this agent adds."}
      </p>
      {issued && data && (
        <div className="stack inline-note" data-tone="accent" data-issued-token>
          <p className="t-label">Copy it now: it is shown only once. Set it in the environment where the agent runs; it reaches {issued.path}.</p>
          <pre id="issued-token" className="read-block t-code" tabIndex={0} aria-label="The new token">{`${data.tokenEnv}=${issued.token}`}</pre>
          <CopyButton text={`${data.tokenEnv}=${issued.token}`} target="issued-token" label="Copy the token" />
        </div>
      )}
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          The tokens could not be read: {error}. Reload the page to try again.
        </p>
      )}
      {data && (
        <>
          <div className="stack">
            <h3 className="t-label" id="mcp-json">
              The .mcp.json block
            </h3>
            <p className="t-help">
              Add this to the repository&apos;s .mcp.json. The token stays in the {data.tokenEnv} environment variable, out of the repository.
            </p>
            <pre id="mcp-json-block" className="read-block t-code" data-mcp-json tabIndex={0} aria-label="The .mcp.json block">
              {data.mcpJson}
            </pre>
            <div>
              <CopyButton text={data.mcpJson} target="mcp-json-block" label="Copy the block" />
            </div>
          </div>
          <div className="stack">
            <h3 className="t-label">Issued tokens</h3>
            {data.tokens.length === 0 ? (
              <Empty text="No tokens yet. Issue one for each place an agent runs, with the fields above." />
            ) : (
              <ul className="rows">
                {data.tokens.map((token) => (
                  <li key={token.id} className="row token-row" data-token={token.label}>
                    <div className="row-main">
                      <span className="t-name">{token.label}</span>
                      <span className="t-meta">
                        Reaches {path(token.nodeId)} · issued {stamp(token.createdAt)} ·{" "}
                        {token.lastUsedAt ? `last read what's new ${stamp(token.lastUsedAt)}` : "has not read what's new yet"}
                      </span>
                    </div>
                    <div className="row-act">
                      {token.revokedAt ? (
                        <span className="pill" data-tone="alert">
                          Revoked
                        </span>
                      ) : (
                        <ConfirmButton confirm="The agent using it stops at once. This cannot be undone." onConfirm={() => void revoke(token.id)}>
                          Revoke
                        </ConfirmButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
