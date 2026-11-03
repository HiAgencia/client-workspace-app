import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/supabase/server";


const PERSON: SessionUser = { id: "11111111-1111-4111-8111-111111111111", email: "alex.rivera@studio.example", isAnonymous: false, name: "Alex Rivera", avatarUrl: null };
const NODE = "22222222-2222-4222-8222-222222222222";
let person: SessionUser = PERSON;

vi.mock("@/lib/supabase/server", () => ({
  userClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: NODE }, error: null }) }) }) }),
  }),
  requireUser: async () => ({ ok: true, user: person }),
}));
vi.mock("@/lib/google/deps", () => ({
  googleDeps: async () => ({ client: { clientId: "client-id", clientSecret: "secret" } }),
  missingGoogleConfig: () => [],
}));
vi.mock("@/lib/env", () => ({ serverEnv: () => "a-secret-of-the-server-that-signs-the-state" }));

async function connect(query: string): Promise<URL> {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest(`http://localhost/api/google/connect?${query}`));
  expect(response.status).toBe(307);
  return new URL(response.headers.get("location")!);
}

describe("starting to connect a Google account", () => {
  beforeEach(() => {
    person = PERSON;
  });

  it("lets the person choose the account in Google, as for a client's", async () => {
    const google = await connect(`node=${NODE}`);
    expect(google.searchParams.get("prompt")).toBe("consent select_account");
    expect(google.searchParams.get("login_hint")).toBeNull();
  });

  it("goes straight to the account of the person signed in with as=session, named by the server", async () => {
    const google = await connect(`node=${NODE}&as=session&login_hint=someone.else@other.example`);
    expect(google.searchParams.get("login_hint")).toBe("alex.rivera@studio.example");
    expect(google.searchParams.get("prompt")).toBe("consent");
    expect(google.searchParams.get("state")).toBeTruthy();
    expect(google.searchParams.get("redirect_uri")).toBe("http://localhost/api/google/callback");
  });

  it("names no account when the session has no address", async () => {
    person = { ...PERSON, email: null };
    const google = await connect(`node=${NODE}&as=session`);
    expect(google.searchParams.get("login_hint")).toBeNull();
  });

  it("refuses the demo, whose session cannot connect an account", async () => {
    person = { ...PERSON, email: null, isAnonymous: true, name: null };
    const { GET } = await import("./route");
    const response = await GET(new NextRequest(`http://localhost/api/google/connect?node=${NODE}&as=session`));
    expect(response.status).toBe(403);
  });
});
