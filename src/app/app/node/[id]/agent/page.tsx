"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, ViewTransition } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { LOCALE } from "@/lib/dates";
import { get, post } from "../../../client-api";
import { ConfirmButton } from "../../../confirm-button";
import { Empty } from "../../../node-view";
import { useWorkspace } from "../../../workspace";

type Token = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Tokens = { tokens: Token[]; mcpJson: string; tokenEnv: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// "Connect your agent": the node's tokens, issuing one (shown once), revoking, and the .mcp.json block to copy.
export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { tree, saving } = useWorkspace();
  const [data, setData] = useState<Tokens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [labelMissing, setLabelMissing] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const [reads, setReads] = useState(0);
  const load = () => setReads((n) => n + 1);

  useEffect(() => {
    void get<Tokens>(`/api/agent-tokens?node=${id}`).then((answer) => {
      if (answer.ok) {
        setData(answer);
        setError(null);
      } else setError(answer.message);
    });
  }, [id, reads]);

  async function issue() {
    if (!label.trim()) return setLabelMissing(true);
    setLabelMissing(false);
    const answer = await post<{ token: string }>("/api/agent-tokens", { action: "issue", nodeId: id, label });
    if (await saving(Promise.resolve(answer))) {
      if (answer.ok) setIssued(answer.token);
      setLabel("");
      load();
    }
  }

  async function revoke(tokenId: string) {
    if (await saving(post("/api/agent-tokens", { action: "revoke", id: tokenId }))) load();
  }

  const node = tree?.find((n) => n.id === id);

  // The page enters whole once the tokens and the project's name are both read: a title that changed its words, and
  // its height, after the rest had painted would push everything below it.
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page">
        {!data || tree === null ? (
          error ? (
            <p role="alert" className="card inline-note" data-tone="alert">
              The tokens could not be read: {error}. Reload the page to try again.
            </p>
          ) : (
            <div className="page" role="status" aria-label="Loading the tokens" aria-busy="true">
              <div className="card stack">
                <span className="skeleton" style={{ width: "22%" }} />
                <span className="skeleton skeleton-title" style={{ width: "55%", height: "1.9rem" }} />
                <span className="skeleton" style={{ width: "85%" }} />
              </div>
              <div className="card stack">
                <span className="skeleton skeleton-title" style={{ width: "28%" }} />
                <span className="skeleton" style={{ width: "100%", height: "2.5rem" }} />
              </div>
            </div>
          )
        ) : (
          <div className="page fade-enter">
            <header className="card page-head">
              <nav aria-label="Path">
                <Link className="link link-meta" href={`/app/node/${id}`}>
                  Back to {node?.name ?? "the project"}
                </Link>
              </nav>
              <h1 className="t-h1" tabIndex={-1}>
                Connect your agent to {node?.name ?? "this project"}
              </h1>
              <p className="t-help">
                A coding agent with a token reads and writes {node?.path ?? "this project"} and everything below it: what is new, the tasks, and the
                decisions. Each token is shown once; revoke it when the agent no longer needs it.
              </p>
            </header>
            <section className="card stack" aria-labelledby="new-token">
              <h2 id="new-token" className="t-title">
                Issue a token
              </h2>
              <div className="quick-add">
                <Field
                  aria-label="Token name"
                  aria-describedby="token-name-help"
                  aria-invalid={labelMissing || undefined}
                  placeholder="Where it will be used, such as laptop"
                  className="grow"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void issue()}
                />
                <Button variant="primary" onClick={() => void issue()}>
                  Issue a token
                </Button>
              </div>
              <p id="token-name-help" className={labelMissing ? "inline-note" : "t-help"} data-tone={labelMissing ? "alert" : undefined}>
                {labelMissing ? "Name the token after where it will be used, such as the laptop." : "The name says which agent wrote what: it shows beside everything it adds."}
              </p>
              {issued && (
                <div className="stack inline-note" data-tone="accent" data-issued-token>
                  <p className="t-label">Copy it now: it is shown only once. Set it in the environment where the agent runs.</p>
                  <pre id="issued-token" className="read-block t-code" tabIndex={0} aria-label="The new token">{`${data.tokenEnv}=${issued}`}</pre>
                  <CopyButton text={`${data.tokenEnv}=${issued}`} target="issued-token" label="Copy the token" />
                </div>
              )}
            </section>
            <section className="card stack" aria-labelledby="mcp-json">
              <h2 id="mcp-json" className="t-title">
                The .mcp.json block
              </h2>
              <p className="t-help">Add this to the repository&apos;s .mcp.json; the token stays in the environment variable, out of the repository.</p>
              <pre id="mcp-json-block" className="read-block t-code" data-mcp-json tabIndex={0} aria-label="The .mcp.json block">
                {data.mcpJson}
              </pre>
              <div>
                <CopyButton text={data.mcpJson} target="mcp-json-block" label="Copy the block" />
              </div>
            </section>
            <section className="card stack" aria-labelledby="tokens">
              <div className="card-head">
                <h2 id="tokens" className="t-title">
                  Tokens
                </h2>
                {data.tokens.length > 0 && <span className="t-meta">{data.tokens.length}</span>}
              </div>
              {data.tokens.length === 0 ? (
                <Empty text="No tokens yet. Issue one above for each place an agent runs." />
              ) : (
                <ul className="rows">
                  {data.tokens.map((token) => (
                    <li key={token.id} className="row token-row" data-token={token.label}>
                      <div className="row-main">
                        <span className="t-name">{token.label}</span>
                        <span className="t-meta">
                          Issued {stamp(token.createdAt)} ·{" "}
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
            </section>
          </div>
        )}
      </div>
    </ViewTransition>
  );
}
