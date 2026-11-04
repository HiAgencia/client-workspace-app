import { Suspense } from "react";
import { connection } from "next/server";
import { publicConfig } from "@/lib/env";
import { WorkspaceShell } from "./workspace";

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  return <WorkspaceShell config={publicConfig()}>{children}</WorkspaceShell>;
}

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense
      fallback={
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
