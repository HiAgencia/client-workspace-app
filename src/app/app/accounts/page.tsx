"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [connectNode, setConnectNode] = useState("");

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
  const path = (id: string) => tree?.find((node) => node.id === id)?.path ?? "a node no longer listed";

  if (!accounts) return <p aria-busy="true">{error ? `The accounts could not be read: ${error}` : "Loading accounts…"}</p>;

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Accounts</h1>
      {error && <p role="alert">The accounts could not be refreshed: {error}</p>}
      <section className="flex flex-wrap items-center gap-2" aria-label="Connect an account">
        {canConnect ? (
          <>
            <select aria-label="Node the new account hangs from" value={connectNode} onChange={(e) => setConnectNode(e.target.value)}>
              <option value="">Pick where it hangs from…</option>
              {tree?.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.path}
                </option>
              ))}
            </select>
            {connectNode ? (
              <a href={`/api/google/connect?node=${connectNode}`}>Connect a Google account</a>
            ) : (
              <span>Pick a node to connect an account to it.</span>
            )}
          </>
        ) : (
          <ConnectBlockedNote reason={connectBlocked} />
        )}
      </section>
      {accounts.length === 0 ? (
        <p>No Google accounts connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-col gap-2" data-account={account.email}>
              <h2 className="font-semibold">
                {account.email}
                {account.status !== "active" && ` — ${account.status}: connect it again`}
                {account.isDemo && " — demo account, read-only"}
              </h2>
              <p>Hangs from:</p>
              <ul className="flex flex-col gap-1 pl-3">
                {account.nodeIds.map((nodeId) => (
                  <li key={nodeId} className="flex items-center gap-2">
                    {path(nodeId)}
                    {!account.isDemo && (
                      <Button variant="ghost" size="sm" onClick={() => void act({ action: "detach", accountId: account.id, nodeId })}>
                        Detach
                      </Button>
                    )}
                  </li>
                ))}
                {account.nodeIds.length === 0 && <li>No node: it shows nowhere until it hangs from one.</li>}
              </ul>
              {!account.isDemo && (
                <select
                  aria-label={`Also show ${account.email} in`}
                  value=""
                  onChange={(e) => e.target.value && void act({ action: "attach", accountId: account.id, nodeId: e.target.value })}
                >
                  <option value="">Also show it in…</option>
                  {tree
                    ?.filter((node) => !account.nodeIds.includes(node.id))
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.path}
                      </option>
                    ))}
                </select>
              )}
              <fieldset className="flex flex-col gap-1">
                <legend>Calendars shown</legend>
                {account.calendars.length === 0 && <p>This account shared no calendars.</p>}
                {account.calendars.map((calendar) => (
                  <label key={calendar.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={calendar.selected}
                      disabled={account.isDemo}
                      onChange={() =>
                        void act({ action: "select_calendar", accountId: account.id, calendarId: calendar.id, selected: !calendar.selected })
                      }
                    />
                    {calendar.name}
                  </label>
                ))}
              </fieldset>
              {!account.isDemo && (
                <ConfirmButton
                  confirm={`${account.email} leaves every node and its access is deleted. This cannot be undone.`}
                  onConfirm={() => void act({ action: "disconnect", accountId: account.id })}
                >
                  Disconnect
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
