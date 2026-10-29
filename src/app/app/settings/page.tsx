"use client";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, ViewTransition, type CSSProperties, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, TextArea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { LOCALE } from "@/lib/dates";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post, tool } from "../client-api";
import { ConfirmButton } from "../confirm-button";
import { ConnectBlockedNote, type ConnectBlocked } from "../connect-blocked";
import { PageHeader } from "../page-header";
import { useWorkspace } from "../workspace";
import "../../styles/settings.css";

// Settings: the theme, the daily review with its instruction, the Google accounts with what each shows of its calendars
// and its mail, and the tokens coding agents use. Each part is a box of the workspace's own skin, in the page's column.
// The boxes enter together once each read its data —or failed—, or at the latest after a short wait: meanwhile they keep
// their place out of sight and the page says what it reads, so a box that grows with its data never pushes one in view.
const PARTS = ["theme-settings", "daily-review", "accounts-settings", "agent-tokens"] as const;
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
  // Once in, the page stays in: a box that reads again later keeps what it shows.
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
              <DailyReviewSection />
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

// A part says when its first read settled.
function useSettled(id: string, settled: boolean) {
  const { report } = useContext(SettledContext);
  useEffect(() => report(id, settled), [id, settled, report]);
}

// One part of the page: a box with its title, its count when it has one, and its content. It shows once the page enters.
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
        {figure !== undefined && figure !== null && <span className="box-count">{figure}</span>}
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

type Preferences = { dailyReview: boolean; dailyReviewInstruction: string };

// How long typing has to stop before the instruction is saved.
const SAVE_AFTER_MS = 800;

// The daily review: on or off, and the instruction it follows. Both save as they change, with no button of their own.
function DailyReviewSection() {
  const { saving, notify } = useWorkspace();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [empty, setEmpty] = useState(false);
  const saved = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What waits to be saved, so leaving the page saves it instead of dropping it.
  const pending = useRef<string | null>(null);

  useSettled("daily-review", prefs !== null || error !== null);

  useEffect(() => {
    let live = true;
    void get<{ preferences: Preferences }>("/api/preferences").then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setPrefs(answer.preferences);
        setInstruction(answer.preferences.dailyReviewInstruction);
        saved.current = answer.preferences.dailyReviewInstruction;
        setError(null);
      } else setError(answer.message);
    });
    return () => {
      live = false;
    };
  }, [round]);

  // A pending instruction is saved when the page is left.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const text = pending.current?.trim();
      if (text && text !== saved.current) void post("/api/preferences", { dailyReviewInstruction: text });
    },
    [],
  );

  async function toggle() {
    if (!prefs) return;
    const next = !prefs.dailyReview;
    setPrefs({ ...prefs, dailyReview: next });
    const ok = await saving(post("/api/preferences", { dailyReview: next }));
    if (!ok) setPrefs((value) => (value ? { ...value, dailyReview: !next } : value));
  }

  function saveInstruction(text: string) {
    clearTimeout(timer.current);
    pending.current = null;
    const clean = text.trim();
    if (!clean) return setEmpty(true);
    setEmpty(false);
    if (clean === saved.current) return;
    void saving(post("/api/preferences", { dailyReviewInstruction: clean })).then((ok) => {
      if (ok) saved.current = clean;
      else notify({ text: "The instruction could not be saved. What you wrote is still in the field.", tone: "error" });
    });
  }

  return (
    <SettingsBox id="daily-review" title="Daily review" order={1}>
      {!prefs ? (
        error ? (
          <BoxFailed what="The daily review's settings" message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
        ) : (
          <BoxWait what="Reading the daily review's settings…" rows={2} />
        )
      ) : (
        <div className="stack fade-enter">
          <div className="settings-line">
            <p className="t-help">
              The first time you open the workspace each day, it reads your overdue tasks, today&apos;s, and those that wait for a message,
              with the mail that arrived for them. It writes what the mail says in each task and completes the ones whose message did
              what they wait for. Each change has its Undo, in the notice and in Activity. You can also ask for it in the chat.
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.dailyReview}
              className="switch settings-switch"
              data-review-switch
              onClick={() => void toggle()}
            >
              <span className="switch-rail" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-text">{prefs.dailyReview ? "On" : "Off"}</span>
            </button>
          </div>
          <div className="stack settings-field">
            <h3 className="t-label" id="review-instruction-label">
              What the review follows
            </h3>
            <TextArea
              id="review-instruction"
              name="review-instruction"
              rows={2}
              value={instruction}
              aria-labelledby="review-instruction-label"
              aria-describedby="review-instruction-help"
              aria-invalid={empty || undefined}
              onChange={(event) => {
                const text = event.target.value;
                setInstruction(text);
                pending.current = text;
                clearTimeout(timer.current);
                timer.current = setTimeout(() => saveInstruction(text), SAVE_AFTER_MS);
              }}
              onBlur={() => saveInstruction(instruction)}
            />
            <p id="review-instruction-help" className={empty ? "inline-note" : "t-help"} data-tone={empty ? "alert" : undefined}>
              {empty
                ? "Write what the review should do: an empty instruction is not saved, and the last one stays."
                : prefs.dailyReview
                  ? "It saves as you write, and the next review follows it."
                  : "It saves as you write. While the review is off it runs only when you ask for it in the chat."}
            </p>
          </div>
        </div>
      )}
    </SettingsBox>
  );
}

type Calendar = { id: string; name: string; color: string | null; selected: boolean };
type Account = { id: string; email: string; status: string; isDemo: boolean; nodeIds: string[]; calendars: Calendar[] };
type MailSummary = {
  groups: Record<"forTasks" | "unread" | "earlier", { count: number; messages: Array<{ id: string; accountId: string; unread: boolean; opened: boolean }> }>;
  failures: Array<{ accountId: string; reason: string }>;
  unreadByAccount: Record<string, number>;
};

// The connected Google accounts, the clients and projects each is connected to, which calendars are shown, and its mail.
function AccountsSection() {
  const { tree, saving, version } = useWorkspace();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [canConnect, setCanConnect] = useState(false);
  const [connectBlocked, setConnectBlocked] = useState<ConnectBlocked>(null);
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<MailSummary | null>(null);
  const [connectNode, setConnectNode] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  // The mail of each account is part of this box's first read: whether it answered or not.
  const [mailRead, setMailRead] = useState(false);
  useSettled("accounts-settings", (accounts !== null || error !== null) && mailRead);

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
    // The same read per account as the Mail page and the sidebar's number, so the three say the same unread.
    void tool<MailSummary>("list_mail", {}).then((answer) => {
      if (!live) return;
      if (answer.ok) setMail(answer);
      setMailRead(true);
    });
    return () => {
      live = false;
    };
  }, [version, round]);

  const act = (body: Record<string, unknown>) => saving(post("/api/accounts", body));
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A place no longer listed";
  const nodeOptions = (tree ?? []).map((node) => ({ value: node.id, label: node.path }));

  // What an account's mail shows here: its unread messages, the reason it could not be read, or that it has none.
  function mailLine(account: Account): { text: string; tone?: "alert" } {
    if (!mail) return { text: "Reading its mail…" };
    const failure = mail.failures.find((entry) => entry.accountId === account.id);
    if (failure) return { text: `Its mail could not be read: ${failure.reason}.`, tone: "alert" };
    // The unread are the account's own count, listed or not —the number the sidebar adds up—; how many messages it holds
    // in all is not said, because the list stops at its limit per account.
    const listed = [...mail.groups.forTasks.messages, ...mail.groups.unread.messages, ...mail.groups.earlier.messages].some((message) => message.accountId === account.id);
    const unread = mail.unreadByAccount[account.id] ?? 0;
    if (!listed && unread === 0) return { text: "No mail in this account yet." };
    const sample = account.isDemo ? ": sample mail, read-only" : "";
    return { text: unread === 0 ? `Nothing unread${sample}.` : `${unread} unread${sample}.` };
  }

  return (
    <SettingsBox id="accounts-settings" title="Google accounts" order={2} count={accounts && accounts.length > 0 ? accounts.length : undefined}>
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
        // With no accounts, the reason is the empty list's own answer, said once below.
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
                        <p className={line.tone ? "inline-note" : "t-value"} data-tone={line.tone} data-account-mail>
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
    // A name the person types is kept with its initial capital, so everything that shows it reads right.
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
    <SettingsBox id="agent-tokens" title="Agent tokens" order={3} count={live ? `${live} in use` : undefined}>
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
                      <ConfirmButton confirm="The agent using it stops at once. This cannot be undone." onConfirm={() => void revoke(token.id)}>
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
