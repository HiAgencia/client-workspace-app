import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readSession } from "@/lib/supabase/server";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";






const GOOGLE = {
  full_name: "Alex Rivera",
  name: "Alex Rivera",
  avatar_url: "https://lh3.googleusercontent.com/a/simulated=s96-c",
  picture: "https://lh3.googleusercontent.com/a/simulated=s96-c",
  email_verified: true,
  iss: "https://accounts.google.com",
};

let user: DisposableUser | undefined;

beforeAll(async () => {
  user = await createDisposableUser("profile");
  const metadata = await serviceClient().auth.admin.updateUserById(user.id, { user_metadata: GOOGLE });
  if (metadata.error) throw metadata.error;
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

async function named() {
  const session = await readSession(user!.client);
  if (session.kind !== "user") throw new Error(`no session: ${session.kind}`);
  return session.user;
}

describe("the name a person goes by", () => {
  it("is Google's, with Google's photo, until the person chooses one", async () => {
    expect(await named()).toMatchObject({ name: "Alex Rivera", avatarUrl: GOOGLE.avatar_url, isAnonymous: false });
  });

  it("is the one chosen in the profile, kept when Google writes its own keys again", async () => {
    const chosen = await user!.client.auth.updateUser({ data: { display_name: "Alex R." } });
    expect(chosen.error).toBeNull();
    expect((await named()).name).toBe("Alex R.");

    
    const again = await serviceClient().auth.admin.updateUserById(user!.id, { user_metadata: { ...GOOGLE, full_name: "Alexandra Rivera", name: "Alexandra Rivera" } });
    expect(again.error).toBeNull();
    expect(await named()).toMatchObject({ name: "Alex R.", avatarUrl: GOOGLE.avatar_url });
  });

  it("goes back to Google's when the chosen one is emptied", async () => {
    const cleared = await user!.client.auth.updateUser({ data: { display_name: null } });
    expect(cleared.error).toBeNull();
    expect((await named()).name).toBe("Alexandra Rivera");
  });
});
