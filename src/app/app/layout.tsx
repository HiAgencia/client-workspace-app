import { Suspense } from "react";
import { connection } from "next/server";
import { publicConfig } from "@/lib/env";
import { WorkspaceShell } from "./workspace";

// The workspace reads its data in the browser through the app's own routes, which check the session on every request.
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  return <WorkspaceShell config={publicConfig()}>{children}</WorkspaceShell>;
}

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<p className="p-6">Opening your workspace…</p>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
