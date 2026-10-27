import { describe, expect, it } from "vitest";
import { safeNext, sameOrigin } from "./http";

const origin = "http://localhost:8787";

// A request as the Worker receives it: the URL may carry an internal host while the browser's own host travels in the
// `Host` header.
const pedido = (url: string, headers: Record<string, string>) => ({ url, headers: new Headers(headers) }) as unknown as Request;

describe("the site a write comes from", () => {
  it("accepts the host the client used, even when the request URL carries another one", () => {
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787" }))).toBe(true);
  });

  it("accepts the request's own origin when no host header decides it", () => {
    expect(sameOrigin(pedido("https://app.example.com/api/demo", { origin: "https://app.example.com" }))).toBe(true);
  });

  it("refuses another host, another port, another scheme, null, and a missing origin", () => {
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { origin: "http://evil.com", host: "localhost:8787" }))).toBe(false);
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { origin: "http://localhost:3000", host: "localhost:8787" }))).toBe(false);
    expect(sameOrigin(pedido("https://localhost:8787/api/demo", { origin: "http://localhost:8787", host: "localhost:8787" }))).toBe(false);
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { origin: "null", host: "localhost:8787" }))).toBe(false);
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { host: "localhost:8787" }))).toBe(false);
  });

  it("refuses an origin that does not parse", () => {
    expect(sameOrigin(pedido("http://localhost:8787/api/demo", { origin: "not a url", host: "localhost:8787" }))).toBe(false);
  });
});

describe("where to land after signing in", () => {
  it("keeps a path on this site with its query", () => {
    expect(safeNext("/app/node/x?google=connected", origin)).toBe("/app/node/x?google=connected");
  });

  it("refuses every way to another host", () => {
    for (const value of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com/app", "javascript:alert(1)"]) {
      expect(safeNext(value, origin)).toBe("/");
    }
  });

  it("falls back to the start without a value", () => {
    expect(safeNext(null, origin)).toBe("/");
  });
});
