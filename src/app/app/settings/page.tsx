"use client";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState, ViewTransition, type CSSProperties, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { LOCALE } from "@/lib/dates";
import { mailFailureText } from "@/lib/mail/failure-text";
import { useMailRead } from "../box-kinds";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post } from "../client-api";
import { ConfirmButton } from "../confirm-button";
import { ConnectBlockedNote, type ConnectBlocked } from "../connect-blocked";
import { PageHeader } from "../page-header";
import { useWorkspace } from "../workspace";
import "../../styles/settings.css";





const PARTS = ["theme-settings", "accounts-settings", "agent-tokens"] as const;
const ENTRY_CAP_MS = 6000;

const SettledContext = createContext<{ ready: boolean; report: (id: string, settled: boolean) => void }>({ ready: true, report: () => undefined });

export default function SettingsPage() {
  const [settled, setSettled] = useState<Record<string, boolean>>({ "theme-settings": true });
  const [capped, setCapped] = useState(false);
  const report = useCallback((id: string, value: boolean) => setSettled((known) => (known[id] === value ? known : { ...known, [id]: value })), []);
  useEffect(() => {
    const timer = setTimeout(() => setCapped(true), ENTRY_CAP_MS);
    return () => clearTimeout(timer);
  }, []);
  
  const [entered, setEntered] = useState(false);
  if (!entered && (capped || PARTS.every((id) => settled[id]))) setEntered(true);

  return (
    <Suspense fallback={null}>
      <ViewTransition enter="page-in" exit="page-out" default="none">
        <div className="page page-settings">
          <PageHeader title="Settings" />
          <SettledContext.Provider value={{ ready: entered, report }}>
            <div className="settings-boxes" data-ready={entered || undefined} aria-busy={!entered || undefined}>
              <ThemeSection />
              <AccountsSection />
              <AgentTokensSection />
              {!entered && (
                <p className="settings-wait t-meta" role="status">
                  Reading your settings, accounts, and tokens…
                </p>
              )}
            </div>
          </SettledContext.Provider>
        </div>
      </ViewTransition>
    </Suspense>
  );
}


function useSettled(id: string, settled: boolean) {
  const { report } = useContext(SettledContext);
  useEffect(() => report(id, settled), [id, settled, report]);
}


function SettingsBox({ id, title, count: figure, order, children }: { id: string; title: string; count?: ReactNode; order: number; children: ReactNode }) {
  const { ready } = useContext(SettledContext);
  return (
    <section
      className="box settings-box"
      aria-labelledby={`${id}-title`}
      id={id}
      data-settings={id}
      data-shown={ready ? "" : undefined}
      style={{ "--enter-delay": `${order * 55}ms` } as CSSProperties}
    >
      <header className="box-head">
        <h2 id={`${id}-title`} className="t-title box-title" tabIndex={-1}>
          {title}
        </h2>
        {figure !== undefined && figure !== null && <span className="pill box-count">{figure}</span>}
      </header>
      <div className="box-body">{children}</div>
    </section>
  );
}

function ThemeSection() {
  return (
    <SettingsBox id="theme-settings" title="Theme" order={0}>
      <div className="settings-line">
        <p className="t-help">Light or dark. It follows your system until you choose, and your choice applies to every open tab.</p>
        <ThemeSwitch />
      </div>
    </SettingsBox>
  );
}


type Calendar = { id: string; name: string; color: string | null; selected: boolean };
type Account = { id: string; email: string; status: string; isDemo: boolean; nodeIds: string[]; calendars: Calendar[] };


function AccountsSection() {
  const { tree, saving, version } = useWorkspace();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [canConnect, setCanConnect] = useState(false);
  const [connectBlocked, setConnectBlocked] = useState<ConnectBlocked>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectNode, setConnectNode] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  
  
  const mailRead = useMailRead({ kind: "all" }, null);
  const mail = mailRead.data;
  useSettled("accounts-settings", (accounts !== null || error !== null) && mailRead.settled);

  useEffect(() => {
    let live = true;
    void get<{ accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked }>("/api/accounts").then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setAccounts(answer.accounts);
        setCanConnect(answer.canConnect);
        setConnectBlocked(answer.connectBlocked);
        setError(null);
      } else setError(answer.message);
    });
    return () => {
      live = false;
    };
  }, [version, round]);

  const act = (body: Record<string, unknown>) => saving(post("/api/accounts", body));
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A place no longer listed";
  const nodeOptions = (tree ?? []).map((node) => ({ value: node.id, label: node.path }));

  
  function mailLine(account: Account): { text: string; tone?: "alert"; failed?: boolean } {
    const failure = mail?.failures.find((entry) => entry.accountId === account.id);
    
    if (failure) return failure.partial ? { text: mailFailureText(failure), failed: true } : { text: `Its mail could not be read: ${failure.reason}.`, tone: "alert", failed: true };
    
    
    const listed = [...(mail?.groups.forTasks.messages ?? []), ...(mail?.groups.unread.messages ?? []), ...(mail?.groups.earlier.messages ?? [])].some((message) => message.accountId === account.id);
    const unread = mail?.unreadByAccount[account.id];
    if (unread === undefined && !listed) return { text: "Reading its mail…" };
    if (!listed && unread === 0) return { text: "No mail in this account yet." };
    const sample = account.isDemo ? ": sample mail, read-only" : "";
    return { text: !unread ? `Nothing unread${sample}.` : `${unread} unread${sample}.` };
  }

  return (
    <SettingsBox id="accounts-settings" title="Google accounts" order={1} count={accounts && accounts.length > 0 ? accounts.length : undefined}>
      <p className="t-help">
        Connect an account to a client or a project to see its calendars and its mail there, and in its projects and subprojects.
      </p>
      {canConnect ? (
        <div className="settings-form" aria-label="Connect an account" role="group">
          <div className="settings-where">
            <Select id="connect-where" label="Where the account connects" placeholder="Client or project…" value={connectNode} options={nodeOptions} onChange={setConnectNode} />
          </div>
          {connectNode ? (
            <a className={buttonClass({ variant: "primary" })} href={`/api/google/connect?node=${connectNode}`}>
              <span className="btn-label">Connect Google account</span>
            </a>
          ) : (
            <Button variant="primary" disabled aria-describedby="connect-why">
              Connect Google account
            </Button>
          )}
          {!connectNode && (
            <span id="connect-why" className="t-help">
              Pick a client or a project first.
            </span>
          )}
        </div>
      ) : (
        
        accounts && accounts.length > 0 && <ConnectBlockedNote reason={connectBlocked} />
      )}
      {!accounts ? (
        error ? (
          <BoxFailed what="The accounts" message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
        ) : (
          <BoxWait what="Reading the accounts…" rows={2} />
        )
      ) : (
        <>
          {error && <BoxFailed what="The accounts" message={error} kept onRetry={() => setRound((n) => n + 1)} />}
          {accounts.length === 0 ? (
            <BoxEmpty text="No Google account connected yet: once one is, its calendars and its mail show in the clients and projects it serves." reason="no-accounts">
              {!canConnect && <ConnectBlockedNote reason={connectBlocked} />}
            </BoxEmpty>
          ) : (
            <ul className="plain-list settings-accounts fade-enter">
              {accounts.map((account) => {
                const line = mailLine(account);
                return (
                  <li key={account.id} className="settings-account" data-account={account.email}>
                    <div className="settings-account-head">
                      <h3 className="t-name">{account.email}</h3>
                      {account.status !== "active" && !account.isDemo && (
                        <span className="pill" data-tone="alert">
                          {account.status === "revoked" ? "Access revoked: connect it again" : account.status}
                        </span>
                      )}
                      {account.isDemo && <span className="pill">Sample account, read-only</span>}
                    </div>
                    <div className="settings-account-grid">
                      <div className="stack settings-part">
                        <h4 className="t-label">Connected to</h4>
                        <ul className="plain-list stack settings-places">
                          {account.nodeIds.map((nodeId) => (
                            <li key={nodeId} className="account-line">
                              <span className="t-value">{path(nodeId)}</span>
                              {!account.isDemo && (
                                <Button size="sm" onClick={() => void act({ action: "detach", accountId: account.id, nodeId })} aria-label={`Detach ${account.email} from ${path(nodeId)}`}>
                                  Detach
                                </Button>
                              )}
                            </li>
                          ))}
                          {account.nodeIds.length === 0 && <li className="t-help">No client or project yet: its calendars and mail show nowhere until it is connected to one.</li>}
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
                      <fieldset className="stack settings-part">
                        <legend className="t-label">Calendars shown</legend>
                        {account.calendars.length === 0 && <p className="t-help">This account shares no calendars.</p>}
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
                      <div className="stack settings-part">
                        <h4 className="t-label">Mail</h4>
                        <p className={line.tone ? "inline-note" : "t-value"} data-tone={line.tone} data-account-mail data-mail-failure={line.failed ? "" : undefined}>
                          {line.text}
                        </p>
                        <a className="link" href={`/app/mail?account=${account.id}`}>
                          Show its mail
                        </a>
                      </div>
                    </div>
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
                );
              })}
            </ul>
          )}
        </>
      )}
    </SettingsBox>
  );
}

type Token = { id: string; nodeId: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Tokens = { tokens: Token[]; mcpJson: string; tokenEnv: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });



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
  useSettled("agent-tokens", data !== null || error !== null);

  useEffect(() => {
    let live = true;
    void get<Tokens>("/api/agent-tokens").then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setData(answer);
        setError(null);
      } else setError(answer.message);
    });
    return () => {
      live = false;
    };
  }, [reads]);

  
  
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
    
    const name = label.trim().replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
    const answer = await post<{ token: string }>("/api/agent-tokens", { action: "issue", nodeId, label: name });
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
  const live = data?.tokens.filter((token) => !token.revokedAt).length;
  return (
    <SettingsBox id="agent-tokens" title="Agent tokens" order={2} count={live ? `${live} in use` : undefined}>
      <p className="t-help">
        A token lets a coding agent read and update one client or project, its projects or subprojects included: its tasks, its notes,
        its decisions, and what changed. Each token is shown once; revoke it when the agent no longer needs it.
      </p>
      <div className="settings-form">
        <div className="settings-where">
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
          placeholder="Token name, such as Laptop"
          className="settings-grow"
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
            ? "Name the token after where the agent runs, such as Laptop."
            : "The name appears beside everything this agent adds."}
      </p>
      {issued && data && (
        <div className="stack inline-note" data-tone="accent" data-issued-token>
          <p className="t-label">Copy it now: it is shown only once. Set it in the environment where the agent runs; it reaches {issued.path}.</p>
          <pre id="issued-token" className="read-block t-code" tabIndex={0} aria-label="The new token">{`${data.tokenEnv}=${issued.token}`}</pre>
          <CopyButton text={`${data.tokenEnv}=${issued.token}`} target="issued-token" label="Copy the token" />
        </div>
      )}
      {!data ? (
        error ? (
          <BoxFailed what="The tokens" message={error} kept={false} onRetry={() => setReads((n) => n + 1)} />
        ) : (
          <BoxWait what="Reading the agent tokens…" rows={2} />
        )
      ) : (
        <>
          {error && <BoxFailed what="The tokens" message={error} kept onRetry={() => setReads((n) => n + 1)} />}
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
              <BoxEmpty text="No tokens yet. Issue one for each place an agent runs, with the fields above." reason="no-tokens" />
            ) : (
              <ul className="plain-list settings-tokens">
                {data.tokens.map((token) => (
                  <li key={token.id} className="settings-token" data-token={token.label}>
                    <div className="settings-token-main">
                      <span className="t-name">{token.label}</span>
                      <span className="t-meta">
                        Reaches {path(token.nodeId)}, issued {stamp(token.createdAt)}.{" "}
                        {token.lastUsedAt ? `Last read what's new ${stamp(token.lastUsedAt)}.` : "It has not read what's new yet."}
                      </span>
                    </div>
                    {token.revokedAt ? (
                      <span className="pill" data-tone="alert">
                        Revoked
                      </span>
                    ) : (
                      <ConfirmButton
                        
                        label={`Revoke “${token.label}” for ${path(token.nodeId)}`}
                        confirm="The agent using it stops at once. This cannot be undone."
                        onConfirm={() => void revoke(token.id)}
                      >
                        Revoke
                      </ConfirmButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </SettingsBox>
  );
}
