import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";


vi.mock("@/lib/supabase/server", () => ({
  userClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }) } }),
}));

async function land(query: string): Promise<string> {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest(`http://localhost/auth/callback?${query}`));
  return new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search;
}

describe("coming back from signing in", () => {
  it("lands in the workspace when no place was asked for", async () => {
    expect(await land("code=one-time")).toBe("/app/resume");
  });

  it("lands where it was asked, on this site only", async () => {
    expect(await land("code=one-time&next=/app/settings")).toBe("/app/settings");
    expect(await land("code=one-time&next=https://elsewhere.example/app")).toBe("/");
  });

  it("goes back to the landing page saying it failed without a code", async () => {
    expect(await land("")).toBe("/?auth=failed");
  });
});
