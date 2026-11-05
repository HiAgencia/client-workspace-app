"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { mcpJson } from "@/lib/agent-token";

const still = () => () => {};
const browserEndpoint = () => new URL("/api/mcp", window.location.origin).toString();

export function McpBlock({ endpoint }: { endpoint: string }) {
  const url = useSyncExternalStore(still, browserEndpoint, () => endpoint);
  return (
    <code>
      {mcpJson(url)
        .split("\n")
        .map((line, index) => (
          <span key={index} className="code-line" style={{ "--indent": line.length - line.trimStart().length } as CSSProperties}>
            {line}
            {"\n"}
          </span>
        ))}
    </code>
  );
}
