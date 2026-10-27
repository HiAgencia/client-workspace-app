"use client";

import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { get, post } from "../client-api";
import { ConfirmButton } from "../confirm-button";
import { ConnectBlockedNote, type ConnectBlocked } from "../connect-blocked";
import { useWorkspace } from "../workspace";

type Calendar = { id: string; name: string; color: string | null; selected: boolean };
type Account = { id: string; email: string; status: string; isDemo: boolean; nodeIds: string[]; calendars: Calendar[] };

// Connected accounts, which nodes each hangs from, and which calendars are shown.
export default function AccountsPage() {
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
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "A node no longer listed";
  const nodeOptions = (tree ?? []).map((node) => ({ value: node.id, label: node.path }));

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page">
        <header className="card page-head">
          <h1 className="t-h1" tabIndex={-1}>
            Accounts
          </h1>
          <p className="t-help">
            A Google account hangs from a client or a project, and shows its calendars there and in everything below it.
          </p>
          {canConnect ? (
            <div className="inline" aria-label="Connect an account" role="group">
              <Select label="Where the new account hangs from" placeholder="Pick where it hangs from…" value={connectNode} options={nodeOptions} onChange={setConnectNode} />
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
                  Pick where it hangs from first.
                </span>
              )}
            </div>
          ) : (
            accounts && <ConnectBlockedNote reason={connectBlocked} />
          )}
        </header>
        {error && (
          <p role="alert" className="inline-note" data-tone="alert">
            The accounts could not be {accounts ? "refreshed" : "read"}: {error}.
          </p>
        )}
        {!accounts ? (
          !error && (
            <div className="card stack" role="status" aria-label="Loading accounts" aria-busy="true">
              <span className="skeleton skeleton-title" style={{ width: "34%" }} />
              <span className="skeleton" style={{ width: "58%" }} />
              <span className="skeleton" style={{ width: "46%" }} />
            </div>
          )
        ) : accounts.length === 0 ? (
          <section className="card fade-enter" aria-label="No accounts">
            <p className="t-help">No Google accounts connected yet.</p>
          </section>
        ) : (
          <ul className="page plain-list fade-enter">
            {accounts.map((account) => (
              <li key={account.id} className="card stack" data-account={account.email}>
                <div className="page-head-row">
                  <h2 className="t-name">{account.email}</h2>
                  {account.status !== "active" && (
                    <span className="pill" data-tone="alert">
                      {account.status === "revoked" ? "Access revoked: connect it again" : account.status}
                    </span>
                  )}
                  {account.isDemo && <span className="pill">Demo account, read-only</span>}
                </div>
                <div className="stack">
                  <h3 className="t-label">Hangs from</h3>
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
                    {account.nodeIds.length === 0 && <li className="t-help">No node: it shows nowhere until it hangs from one.</li>}
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
                        onCheckedChange={() =>
                          void act({ action: "select_calendar", accountId: account.id, calendarId: calendar.id, selected: !calendar.selected })
                        }
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
                      confirm={`${account.email} leaves every node and its access is deleted. This cannot be undone.`}
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
      </div>
    </ViewTransition>
  );
}
