import type { Metadata } from "next";
import { Suspense } from "react";
import { savedLayout } from "./saved-layout";
import { BoardShell, Overview } from "./overview";
import { SCREEN_TITLES } from "./screen-titles";

export const metadata: Metadata = { title: SCREEN_TITLES["/app"] };


export default async function OverviewPage() {
  const saved = await savedLayout("overview");
  return (
    <Suspense fallback={<BoardShell />}>
      <Overview saved={saved.board} />
    </Suspense>
  );
}
