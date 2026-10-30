import type { Metadata } from "next";
import { Suspense } from "react";
import { savedLayout } from "./saved-layout";
import { BoardShell, Overview } from "./overview";

export const metadata: Metadata = { title: "Overview" };


export default async function OverviewPage() {
  const saved = await savedLayout("overview");
  return (
    <Suspense fallback={<BoardShell />}>
      <Overview saved={saved.board} />
    </Suspense>
  );
}
