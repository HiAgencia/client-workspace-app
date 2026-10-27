import { Suspense } from "react";
import { connection } from "next/server";
import { publicConfig } from "@/lib/env";
import { SignIn } from "./sign-in";

// Read per request: the Supabase address and key come from the server's variables, not from the build.
async function SessionControls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const { auth } = await searchParams;
  return <SignIn config={publicConfig()} failed={auth === "failed"} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-start justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">client-workspace</h1>
      <p>A task manager where the project is the unit.</p>
      <Suspense fallback={<p>Checking your session…</p>}>
        <SessionControls searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
