import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { publicConfig } from "@/lib/env";
import { translateNow } from "@/lib/strings";
import { WorkspaceShell } from "./workspace";

export const metadata: Metadata = { robots: { index: false } };

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  return <WorkspaceShell config={publicConfig()}>{children}</WorkspaceShell>;
}

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense
      fallback={
        <div className="shell" role="status" aria-busy="true" aria-label={translateNow("workspace.opening")}>
          <div className="topbar" />
          <div className="sidebar" />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
