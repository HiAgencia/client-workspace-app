import type { Metadata } from "next";
import { Suspense } from "react";
import { savedLayout } from "./saved-layout";
import { BoardShell, Overview } from "./overview";

export const metadata: Metadata = { title: "Overview" };

// The Overview enters already in the order its person gave its boxes: the server reads it from the layout cookie.
export default async function OverviewPage() {
  const saved = await savedLayout("overview");
  return (
    <Suspense fallback={<BoardShell />}>
      <Overview saved={saved.board} />
    </Suspense>
  );
}
