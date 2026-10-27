// A coding agent's access token: random, shown once, stored only as its SHA-256. The prefix lets a person (and a
// secret scanner) recognize it; the edge filters only its shape.
const PREFIX = "cwa_";
const SHAPE = /^cwa_[A-Za-z0-9_-]{43}$/;

export function newAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function looksLikeAgentToken(value: string): boolean {
  return SHAPE.test(value);
}

export async function hashAgentToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The environment variable a repository's .mcp.json reads the token from.
export const TOKEN_ENV = "CLIENT_WORKSPACE_TOKEN";

export function mcpJson(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "client-workspace": {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer \${${TOKEN_ENV}}` },
        },
      },
    },
    null,
    2,
  );
}
