"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { get, post } from "../../../client-api";
import { ConfirmButton } from "../../../confirm-button";
import { useWorkspace } from "../../../workspace";

type Token = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Tokens = { tokens: Token[]; mcpJson: string; tokenEnv: string };

// "Connect your agent": the node's tokens, issuing one (shown once), revoking, and the .mcp.json block to copy.
export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { tree, saving, notify } = useWorkspace();
  const [data, setData] = useState<Tokens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
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
    if (!label.trim()) return notify({ text: "Name the token after where it will be used, such as the laptop.", tone: "error" });
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
  if (!data) return <p aria-busy="true">{error ? `The tokens could not be read: ${error}` : "Loading…"}</p>;

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Connect your agent to {node?.path ?? "this node"}</h1>
      <p>
        A coding agent with this token reads and writes this node and everything below it. <Link href={`/app/node/${id}`}>Back to the node</Link>
      </p>
      <section className="flex flex-wrap items-center gap-2" aria-label="New token">
        <Input aria-label="Token name" placeholder="Where it will be used, such as laptop" className="max-w-xs" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button onClick={() => void issue()}>Issue a token</Button>
      </section>
      {issued && (
        <section className="flex flex-col gap-2" aria-label="The new token" data-issued-token>
          <p>Copy it now: it is shown only once. Set it in the environment where the agent runs:</p>
          <pre className="overflow-x-auto" tabIndex={0} aria-label="The new token">{`${data.tokenEnv}=${issued}`}</pre>
        </section>
      )}
      <section className="flex flex-col gap-2" aria-label="The .mcp.json block">
        <p>Add this to the repository&apos;s .mcp.json; the token stays in the environment variable, out of the repository:</p>
        <pre className="overflow-x-auto" data-mcp-json tabIndex={0} aria-label="The .mcp.json block">
          {data.mcpJson}
        </pre>
      </section>
      <section className="flex flex-col gap-2" aria-label="Tokens">
        <h2 className="font-semibold">Tokens</h2>
        {data.tokens.length === 0 ? (
          <p>No tokens yet. Issue one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3" data-token={token.label}>
                <span>{token.label}</span>
                <span>issued {new Date(token.createdAt).toLocaleString()}</span>
                <span>
                  {token.lastUsedAt ? `last read what's new ${new Date(token.lastUsedAt).toLocaleString()}` : "has not read what's new yet"}
                </span>
                {token.revokedAt ? (
                  <span>revoked</span>
                ) : (
                  <ConfirmButton confirm="The agent using it stops at once. This cannot be undone." onConfirm={() => void revoke(token.id)}>
                    Revoke
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
