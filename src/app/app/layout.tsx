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
    <Suspense
      fallback={
        // The frame's own surfaces wait in their place —the phone's bar, the computer's sidebar—, so the workspace
        // arrives inside them without a jump.
        <div className="shell" role="status" aria-busy="true" aria-label="Opening your workspace">
          <div className="topbar" />
          <div className="sidebar" />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
