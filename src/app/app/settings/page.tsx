"use client";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState, ViewTransition, type CSSProperties, type ReactNode } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { Link } from "@/components/ui/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { AccountIcon, AddIcon, ColorIcon, OpenIcon, TokenIcon, type Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { LOCALE } from "@/lib/dates";
import { useMailRead } from "../box-kinds";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post } from "../client-api";
import { ConfirmButton } from "../confirm-button";
import { ConnectBlockedNote, type ConnectBlocked } from "../connect-blocked";
import { lostWords } from "../mail-store";
import { PageHeader } from "../page-header";
import { accountGroups } from "../place-filters";
import { PlaceName } from "../task-row";
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



function SettingsBox({ id, title, icon: Glyph, count: figure, order, children }: { id: string; title: string; icon: Icon; count?: ReactNode; order: number; children: ReactNode }) {
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
        <span className="box-icon" aria-hidden="true">
          <Glyph />
        </span>
        <h2 id={`${id}-title`} className="t-title box-title" tabIndex={-1}>
          {title}
        </h2>
        {figure !== undefined && figure !== null && <span className="box-count">{figure}</span>}
      </header>
      <div className="box-body">{children}</div>
    </section>
  );
}



function FirstPlace({ what }: { what: string }) {
  return (
    <div className="settings-first" data-first-place>
      <p className="t-help">{what}</p>
      <Link href="/app" className={buttonClass({ size: "sm" })}>
        <AddIcon />
        <span className="btn-label">Add your own project</span>
      </Link>
    </div>
  );
}

function ThemeSection() {
  return (
    <SettingsBox id="theme-settings" title="Theme" icon={ColorIcon} order={0}>
      <div className="settings-line">
        <p className="t-help">Follows your system until you choose.</p>
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
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A client or project no longer listed";
  const colorOf = (id: string) => tree?.find((node) => node.id === id)?.color ?? null;
  const nodeOptions = (tree ?? []).map((node) => ({ value: node.id, label: node.path }));

  
  
  function mailLine(account: Account): { text: string; tone?: "alert"; failed?: boolean } {
    const failure = mail?.failures.find((entry) => entry.accountId === account.id);
    
    if (failure) {
      const reason = failure.reason.replace(/\.+$/, "");
      return failure.partial ? { text: reason.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()), failed: true } : { text: `Could not be read: ${reason}`, tone: "alert", failed: true };
    }
    
    
    const listed = [...(mail?.groups.forTasks.messages ?? []), ...(mail?.groups.unread.messages ?? []), ...(mail?.groups.earlier.messages ?? [])].some((message) => message.accountId === account.id);
    const unread = mail?.unreadByAccount[account.id];
    if (unread === undefined && !listed) return { text: "Reading…" };
    if (!listed && unread === 0) return { text: "No mail yet" };
    return { text: !unread ? "Nothing unread" : `${unread} unread` };
  }

  return (
    <SettingsBox id="accounts-settings" title="Google accounts" icon={AccountIcon} order={1} count={accounts && accounts.length > 0 ? `${accounts.length} connected` : undefined}>
      <p className="t-help">An account&apos;s calendars and mail show in the client or project it is connected to, and in its projects.</p>
      {tree !== null && tree.length === 0 ? (
        <FirstPlace what="An account is connected to a client or a project, so there is nowhere to connect one yet." />
      ) : canConnect ? (
        <div className="settings-form" aria-label="Connect Google account" role="group">
          <div className="settings-where">
            <Select id="connect-where" label="Connect to" placeholder="Pick a client or a project…" value={connectNode} options={nodeOptions} onChange={setConnectNode} />
          </div>
          {connectNode ? (
            <a className={buttonClass({ variant: "primary" })} href={`/api/google/connect?node=${connectNode}`}>
              <GoogleMark />
              <span className="btn-label">Connect Google account</span>
            </a>
          ) : (
            <Button variant="primary" disabled aria-describedby="connect-why">
              <GoogleMark />
              <span className="btn-label">Connect Google account</span>
            </Button>
          )}
          {!connectNode && (
            <span id="connect-why" className="t-help">
              Pick a client or a project first.
            </span>
          )}
        </div>
      ) : (
        
        accounts && accounts.length > 0 && <ConnectBlockedNote reason={connectBlocked} samples={accounts.some((account) => account.isDemo)} />
      )}
      {!accounts ? (
        error ? (
          <BoxFailed what="The accounts" message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
        ) : (
          <BoxWait what="Loading the accounts…" rows={2} />
        )
      ) : (
        <>
          {error && <BoxFailed what="The accounts" message={error} kept onRetry={() => setRound((n) => n + 1)} />}
          {accounts.length === 0 ? (
            <BoxEmpty text="No Google account connected yet." reason="no-accounts">
              {!canConnect && <ConnectBlockedNote reason={connectBlocked} samples={false} />}
            </BoxEmpty>
          ) : (
            
            
            
            <div className="settings-accounts-frame fade-enter">
              <table className="settings-accounts" role="table" aria-labelledby="accounts-settings-title">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      Account
                    </th>
                    <th scope="col" role="columnheader">
                      Connected to
                    </th>
                    <th scope="col" role="columnheader">
                      Calendars
                    </th>
                    <th scope="col" role="columnheader">
                      Mail
                    </th>
                    <th scope="col" role="columnheader">
                      <span className="sr-only">Its mail</span>
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {}
                  {accountGroups(accounts, tree).flatMap((group) => group.accounts).map((account) => {
                    const line = mailLine(account);
                    return (
                      <tr key={account.id} role="row" className="settings-account" data-account={account.email}>
                        <th scope="row" role="rowheader" className="settings-account-who">
                          <span className="settings-account-name">
                            <GoogleMark />
                            <span className="t-name">{account.email}</span>
                          </span>
                          {account.status !== "active" && !account.isDemo && (
                            <span className="pill" data-tone="alert">
                              {lostWords(account.status)}
                            </span>
                          )}
                          {!account.isDemo && (
                            <span className="settings-account-out">
                              <ConfirmButton
                                confirm={`${account.email} will be removed from every client and project, and its access revoked. This cannot be undone.`}
                                onConfirm={() => void act({ action: "disconnect", accountId: account.id })}
                              >
                                Disconnect
                              </ConfirmButton>
                            </span>
                          )}
                        </th>
                        <td role="cell">
                          <span className="settings-cell-name" aria-hidden="true">
                            Connected to
                          </span>
                          <div className="settings-cell-value">
                            {account.nodeIds.length === 0 ? (
                              <span className="t-help">Not connected yet</span>
                            ) : (
                              <ul className="plain-list settings-places">
                                {account.nodeIds.map((nodeId) => (
                                  <li key={nodeId}>
                                    <PlaceName path={path(nodeId)} color={colorOf(nodeId)} />
                                    {!account.isDemo && (
                                      <Button size="sm" variant="quiet" onClick={() => void act({ action: "detach", accountId: account.id, nodeId })} aria-label={`Remove ${account.email} from ${path(nodeId)}`}>
                                        Remove
                                      </Button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {!account.isDemo && (
                              <Select
                                label={`Also show ${account.email} in`}
                                placeholder={account.nodeIds.length === 0 ? "Connect to…" : "Also connect to…"}
                                value={null}
                                options={nodeOptions.filter((option) => !account.nodeIds.includes(option.value))}
                                onChange={(nodeId) => void act({ action: "attach", accountId: account.id, nodeId })}
                              />
                            )}
                          </div>
                        </td>
                        <td role="cell">
                          <span className="settings-cell-name" aria-hidden="true">
                            Calendars
                          </span>
                          <div className="settings-cell-value">
                            {account.calendars.length === 0 ? (
                              <span className="t-help">None shared</span>
                            ) : (
                              <ul className="plain-list settings-calendars" aria-label={`Calendars of ${account.email} shown`}>
                                {account.calendars.map((calendar) => (
                                  <li key={calendar.id}>
                                    <label className="check-row">
                                      <Checkbox
                                        checked={calendar.selected}
                                        disabled={account.isDemo}
                                        aria-labelledby={`calendar-${calendar.id}`}
                                        onCheckedChange={() => void act({ action: "select_calendar", accountId: account.id, calendarId: calendar.id, selected: !calendar.selected })}
                                      />
                                      <span id={`calendar-${calendar.id}`} className="t-value">
                                        {calendar.name}
                                      </span>
                                      {}
                                      {calendar.color && <span className="settings-calendar-color" style={{ "--swatch": calendar.color } as CSSProperties} aria-hidden="true" />}
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                        <td role="cell">
                          <span className="settings-cell-name" aria-hidden="true">
                            Mail
                          </span>
                          <div className="settings-cell-value">
                            <span className={line.tone ? "settings-mail-failed" : "t-value"} data-account-mail data-mail-failure={line.failed ? "" : undefined}>
                              {line.text}
                            </span>
                          </div>
                        </td>
                        <td role="cell" className="settings-account-go">
                          <a className={buttonClass({ variant: "quiet", size: "sm", className: "head-action head-link" })} href={`/app/mail?account=${account.id}`}>
                            <span className="btn-label">Show its mail</span>
                            <OpenIcon />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SettingsBox>
  );
}

type Token = { id: string; nodeId: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Tokens = { tokens: Token[]; mcpJson: string; tokenEnv: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });


function CodeLines({ text }: { text: string }) {
  return text.split("\n").map((line, index) => (
    <span key={index} className="code-line" style={{ "--indent": line.length - line.trimStart().length } as CSSProperties}>
      {line}
      {"\n"}
    </span>
  ));
}



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
  const [blockOpen, setBlockOpen] = useState(false);
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

  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A client or project no longer listed";
  const live = data?.tokens.filter((token) => !token.revokedAt).length;
  return (
    <SettingsBox id="agent-tokens" title="Agent tokens" icon={TokenIcon} order={2} count={live ? `${live} in use` : undefined}>
      <p className="t-help">A token lets a coding agent read and update one client or project, and everything in it.</p>
      {tree !== null && tree.length === 0 ? (
        <FirstPlace what="A token reaches one client or project, so there is none to issue one for yet." />
      ) : (
        <>
      <div className="settings-form">
        <div className="settings-where">
          <Select
            id="token-where"
            label="Client or project"
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
        </>
      )}
      {issued && data && (
        <div className="stack inline-note" data-tone="accent" data-issued-token>
          <p className="t-label">Copy it now: it won’t be shown again. Set it where the agent runs. It works for {issued.path}.</p>
          <pre id="issued-token" className="read-block t-code" tabIndex={0} aria-label="The new token">{`${data.tokenEnv}=${issued.token}`}</pre>
          <CopyButton text={`${data.tokenEnv}=${issued.token}`} target="issued-token" label="Copy the token" />
        </div>
      )}
      {!data ? (
        error ? (
          <BoxFailed what="The tokens" message={error} kept={false} onRetry={() => setReads((n) => n + 1)} />
        ) : (
          <BoxWait what="Loading the agent tokens…" rows={2} />
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
            <div className="inline settings-mcp-tools">
              <CopyButton text={data.mcpJson} target="mcp-json-block" label="Copy the block" onSelecting={() => setBlockOpen(true)} />
              <Button size="sm" aria-expanded={blockOpen} aria-controls="mcp-json-fold" onClick={() => setBlockOpen((open) => !open)}>
                {blockOpen ? "Hide the block" : "Show the block"}
              </Button>
            </div>
            <Fold open={blockOpen} id="mcp-json-fold">
              <pre id="mcp-json-block" className="read-block t-code" data-mcp-json tabIndex={blockOpen ? 0 : -1} aria-label="The .mcp.json block">
                <CodeLines text={data.mcpJson} />
              </pre>
            </Fold>
          </div>
          <div className="stack">
            <h3 className="t-label">Issued tokens</h3>
            {data.tokens.length === 0 ? (
              <BoxEmpty text="No tokens yet." reason="no-tokens" />
            ) : (
              <ul className="plain-list settings-tokens">
                {data.tokens.map((token) => (
                  <li key={token.id} className="settings-token" data-token={token.label}>
                    <div className="settings-token-main">
                      <span className="t-name">{token.label}</span>
                      {}
                      <span className="t-meta">{[`For ${path(token.nodeId)}`, `Issued ${stamp(token.createdAt)}`, token.lastUsedAt ? `Last synced ${stamp(token.lastUsedAt)}` : null].filter(Boolean).join(" · ")}</span>
                    </div>
                    {token.revokedAt ? (
                      <span className="pill" data-tone="alert">
                        Revoked
                      </span>
                    ) : (
                      <ConfirmButton
                        
                        label={`Revoke “${token.label}” for ${path(token.nodeId)}`}
                        confirm="Any agent using it loses access at once. This cannot be undone."
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
